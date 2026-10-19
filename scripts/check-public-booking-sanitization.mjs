import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const booking = read("supabase/functions/citabot-public-booking/index.ts");
assert.match(booking, /CLIENT_BOOKING_ERRORS/);
assert.match(booking, /No se pudo cargar la información de reservas\. Inténtalo de nuevo más tarde\./);
assert.match(booking, /No se pudo completar la reserva\. Inténtalo de nuevo más tarde\./);
assert.match(booking, /PUBLIC_BOOKING_LOOKUP_FAILED/);
assert.match(booking, /PUBLIC_BOOKING_CREATE_FAILED/);
assert.match(booking, /El cuerpo de la solicitud no es JSON válido\./);
assert.doesNotMatch(booking, /json\(\{\s*ok:\s*false,\s*error:\s*error\.message/);
assert.doesNotMatch(booking, /error:\s*error instanceof Error\s*\?\s*error\.message/);

const whatsapp = read("supabase/functions/citabot-whatsapp-webhook/index.ts");
assert.match(whatsapp, /function logBackendFailure/);
assert.match(whatsapp, /No se pudo procesar el webhook\./);
assert.doesNotMatch(whatsapp, /JSON\.stringify\(\{error:e instanceof Error\?e\.message/);
assert.doesNotMatch(whatsapp, /console\.error\("CITABOT_WEBHOOK_ERROR",e\)/);
assert.doesNotMatch(whatsapp, /console\.error\("CITABOT_(?:READ_RECEIPT_FAILED|AI_FALLBACK)",e\)/);

const mercadoPago = read("supabase/functions/citabot-mercadopago-webhook/index.ts");
assert.match(mercadoPago, /function logWebhookFailure/);
assert.match(mercadoPago, /No se pudo procesar el evento de pago/);
assert.doesNotMatch(mercadoPago, /e instanceof Error\?e\.message:'Error interno'/);
// The legacy provider simulator fixture is acknowledged only after HMAC signature verification.
// Keep production's compatibility guard in source control and reject attempts to move it earlier.
const signatureVerificationPosition = mercadoPago.indexOf("if(!(await verifySignature(req,dataId)))");
const simulatorGuardPosition = mercadoPago.indexOf("const legacySimulatorSample=");
assert.ok(signatureVerificationPosition >= 0, "webhook must verify the provider signature");
assert.ok(simulatorGuardPosition > signatureVerificationPosition, "legacy simulator guard must remain after signature verification");
assert.match(mercadoPago, /if\(legacySimulatorSample\)return json\(\{ok:true,simulation:true,ignored:true\}\);/);

assert.doesNotMatch(mercadoPago, /console\.error\('CITABOT_MERCADOPAGO_WEBHOOK_ERROR',e\)/);

// Payment webhooks must propagate every ledger/entitlement write failure so
// Mercado Pago retries instead of treating a partial update as delivered.
assert.match(mercadoPago, /function throwOnDbError/);
for (const operation of [
  "authorized_payment_ledger",
  "authorized_payment_revenue",
  "authorized_payment_subscription_activation",
  "boost_order_status_update",
  "boost_order_dates",
  "boost_order_paid_status",
  "boost_refund_revenue",
  "boost_refund_revoke",
  "boost_refund_status",
  "boost_directory_activation",
  "boost_revenue",
  "payment_subscription_lookup",
  "payment_ledger",
  "payment_revenue",
  "payment_subscription_activation",
]) {
  assert.ok(mercadoPago.includes('throwOnDbError("' + operation + '"'), "missing DB error check: " + operation);
}
assert.match(mercadoPago, /BOOST_DIRECTORY_LISTING_MISSING/);
assert.match(mercadoPago, /PAYMENT_ID_MISMATCH/);
assert.ok(mercadoPago.includes("order.starts_at?new Date(order.starts_at):new Date()"), "boost start/end timestamps must remain stable across retries");

// Refunded directory boosts must revoke only their own featured interval,
// and manual reconciliation must be able to repair paid/refunded orders.
assert.ok(mercadoPago.includes('else if(status==="refunded")'), "webhook must reconcile refunded boosts");
assert.ok(mercadoPago.includes('.eq("featured_until",order.ends_at)'), "webhook must not remove a newer promotion");
assert.ok(mercadoPago.includes('status:"refunded"'), "webhook must mark refund status");
const commercialSync = read("supabase/functions/citabot-commercial-sync/index.ts");
assert.match(commercialSync, /function throwOnDbError/);
assert.ok(commercialSync.includes('.in("status", ["pending", "paid", "refunded"])'), "manual sync must revisit paid/refunded boost orders");
assert.ok(commercialSync.includes('.eq("featured_until", order.ends_at)'), "manual sync must preserve newer promotions");
assert.ok(commercialSync.includes('No se pudo sincronizar el plan o las promociones.'), "manual sync must hide raw provider/DB errors");
assert.doesNotMatch(commercialSync, /console\\.error\\("CITABOT_COMMERCIAL_SYNC_ERROR",e\\)/);

const checkout = read("supabase/functions/citabot-commercial-checkout/index.ts");
assert.match(checkout, /function cancelAndVerifyPreapproval/);
assert.match(checkout, /function markBoostOrderFailed/);
assert.match(checkout, /CITABOT_BOOST_PREFERENCE_PERSIST_FAILED/);
assert.match(checkout, /preference_reference/);
assert.doesNotMatch(checkout, /pd\?\.message\|\|"No se pudo crear el pago\."/);
assert.ok(checkout.includes('eq("id",o.data.id).eq("status","pending").select("id").maybeSingle()'), "must check and constrain preference persistence");

assert.match(checkout, /function recordSubscriptionChange/);
assert.match(checkout, /subscription_change_reconciliation/);
assert.match(checkout, /No completes/i);
assert.match(checkout, /CITABOT_CHECKOUT_CANCEL_REQUEST_FAILED/);
assert.doesNotMatch(checkout, /El nuevo intento de Premium fue cancelado para evitar cobros dobles/);
assert.doesNotMatch(checkout, /await fetch\("https:\/\/api\.mercadopago\.com\/preapproval\/".*\.catch\(\(\)=>null\)/);
assert.doesNotMatch(checkout, /error:e instanceof Error\?e\.message/);
assert.ok(
  checkout.indexOf("recordSubscriptionChange(businessId,prior)") < checkout.indexOf('fetch("https://api.mercadopago.com/preapproval",{'),
  "must reserve the per-business reconciliation lock before creating a provider subscription"
);
const reconciliationMigration = read("supabase/migrations/20261009004000_citabot_subscription_change_reconciliation.sql");
const reconciliationLockMigration = read("supabase/migrations/20261009004100_citabot_serialize_subscription_changes.sql");
assert.match(reconciliationMigration, /enable row level security/);
assert.match(reconciliationMigration, /revoke all on table public\.subscription_change_reconciliation from public, anon, authenticated/i);
assert.match(reconciliationMigration, /grant all on table public\.subscription_change_reconciliation to service_role/i);
assert.match(reconciliationLockMigration, /create unique index.*subscription_change_reconciliation_one_unresolved_per_business_idx/i);
assert.match(reconciliationLockMigration, /alter column new_subscription_id drop not null/i);


// Security regression guards for privilege changes applied to production.
// These tables/functions must stay inaccessible to application roles across future migrations.
const legalAcceptancePrivileges = read("supabase/migrations/20261009221641_citabot_revoke_unsafe_legal_acceptance_privileges.sql");
assert.match(legalAcceptancePrivileges, /REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public\.legal_acceptances FROM authenticated/i);

const privateFunctionPrivileges = read("supabase/migrations/20261009222627_citabot_revoke_private_function_execution_from_client_roles.sql");
assert.match(privateFunctionPrivileges, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated/i);

const reconciliationClientAccess = read("supabase/migrations/20261009222936_citabot_explicitly_deny_client_access_to_subscription_reconciliation.sql");
assert.match(reconciliationClientAccess, /FOR ALL\s+TO anon, authenticated\s+USING \(false\)\s+WITH CHECK \(false\)/i);


const citabotAi = read("supabase/functions/citabot-ai/index.ts");
assert.match(citabotAi, /CITABOT_AI_PROVIDER_FAILED/);
assert.match(citabotAi, /provider_status:rr\?\.status\|\|null[\s\S]*\{status:503,headers:\{\.\.\.cors,"Content-Type":"application\/json"\}\}/);
assert.match(citabotAi, /CITABOT_AI_INTERNAL_FAILURE/);
assert.match(citabotAi, /No se pudo procesar la solicitud de IA temporalmente\./);
assert.doesNotMatch(citabotAi, /JSON\.stringify\(\{error:e instanceof Error\?e\.message/);
assert.doesNotMatch(citabotAi, /error:lastProviderError/);


const whatsappSend = read("supabase/functions/citabot-whatsapp-send/index.ts");
assert.match(whatsappSend, /isInsideWhatsAppCustomerServiceWindow\(lastInbound\?\.provider_timestamp\)/);
assert.match(whatsappSend, /isInsideWhatsAppCustomerServiceWindow\(freshInbound\?\.provider_timestamp\)/);
assert.match(whatsappSend, /customer\.whatsapp_opted_out_at/);
assert.match(whatsappSend, /WHATSAPP_RECIPIENT_OPTED_OUT/);
assert.match(whatsappSend, /WHATSAPP_SERVICE_WINDOW_CLOSED/);
assert.match(whatsappSend, /\.not\("provider_timestamp", "is", null\)/);
assert.ok(
  whatsappSend.lastIndexOf("WHATSAPP_SERVICE_WINDOW_CLOSED") < whatsappSend.indexOf("const { data: messageRow, error: queueError }"),
  "the final open-window guard must run after Meta validation and before queuing an outbound message"
);
assert.match(whatsappSend, /latestCustomer\.whatsapp_opted_out_at/);
assert.ok(
  whatsappSend.indexOf("latestCustomer.whatsapp_opted_out_at") < whatsappSend.indexOf("const { data: messageRow, error: queueError }"),
  "the final opt-out check must run before queuing an outbound message"
);
assert.match(whatsappSend, /WHATSAPP_ACCESS_TOKEN/);
assert.match(whatsappSend, /CITABOT_WHATSAPP_SEND_FAILED/);
assert.doesNotMatch(whatsappSend, /error:\s*error instanceof Error\s*\?\s*error\.message/);

const customerServiceWindow = read("supabase/functions/_shared/whatsapp-compliance.ts");
assert.match(customerServiceWindow, /24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
assert.match(customerServiceWindow, /age\s*>=\s*0/);
assert.match(customerServiceWindow, /age\s*<\s*CUSTOMER_SERVICE_WINDOW_MS/);
assert.match(customerServiceWindow, /function parseWhatsAppProviderTimestamp/);
assert.match(customerServiceWindow, /timestampMs\s*>\s*nowMs/);

const whatsappWebhook = read("supabase/functions/citabot-whatsapp-webhook/index.ts");
assert.match(whatsappWebhook, /from ["']\.\/opt-out\.ts["']/);
assert.match(whatsappWebhook, /from ["']\.\.\/_shared\/whatsapp-compliance\.ts["']/);
assert.match(whatsappWebhook, /parseWhatsAppProviderTimestamp\(m\.timestamp\)/);
assert.match(whatsappWebhook, /provider_timestamp:providerTimestamp/);
assert.match(whatsappWebhook, /CITABOT_AUTOREPLY_SKIPPED_CLOSED_WINDOW/);
assert.match(whatsappWebhook, /CITABOT_OPTOUT_ACK_SKIPPED_CLOSED_WINDOW/);
assert.match(whatsappWebhook, /whatsapp_opted_out_at:optedOutAt/);
assert.match(whatsappWebhook, /CITABOT_WHATSAPP_OPTOUT_RECORDED/);
assert.match(whatsappWebhook, /if\(isWhatsAppOptOut\(text\)\)[\s\S]*?continue;/);
const whatsappOptOut = read("supabase/functions/citabot-whatsapp-webhook/opt-out.ts");
assert.match(whatsappOptOut, /function isWhatsAppOptOut/);
assert.match(whatsappOptOut, /normalizeOptOutText/);

const providerTimestampMigration = read("supabase/migrations/20261019005500_citabot_whatsapp_provider_timestamp.sql");
assert.match(providerTimestampMigration, /ADD COLUMN IF NOT EXISTS provider_timestamp timestamptz/i);
assert.match(providerTimestampMigration, /messages_whatsapp_inbound_provider_ts_idx/);

const professionalSubscribe = read("supabase/functions/citabot-mercadopago-subscribe/index.ts");
assert.match(professionalSubscribe, /function reserveCheckout/);
assert.match(professionalSubscribe, /subscription_change_reconciliation/);
assert.match(professionalSubscribe, /No se creó una segunda suscripción/);
assert.match(professionalSubscribe, /function cancelAndVerifyPreapproval/);
assert.match(professionalSubscribe, /PROVIDER_CREATE_STATE_UNKNOWN/);
assert.match(professionalSubscribe, /reconciliation_required/);
assert.doesNotMatch(professionalSubscribe, /error:e instanceof Error\?e\.message/);
assert.ok(
  professionalSubscribe.indexOf("reserveCheckout(businessId, prior)") < professionalSubscribe.indexOf('fetch("https://api.mercadopago.com/preapproval", {'),
  "Professional checkout must reserve the per-business lock before creating Mercado Pago's preapproval"
);
const professionalReconciliationMigration = read("supabase/migrations/20261019005300_citabot_allow_professional_subscription_reconciliation.sql");
assert.match(professionalReconciliationMigration, /drop constraint if exists subscription_change_reconciliation_new_plan_check/i);
assert.match(professionalReconciliationMigration, /check \(new_plan in \('premium', 'professional'\)\)/i);


console.log("Public Edge error-sanitization guard: OK");
