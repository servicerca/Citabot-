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

console.log("Public Edge error-sanitization guard: OK");
