import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [subscribe, sync, webhook, validation, checkout] = await Promise.all([
  readFile(new URL("supabase/functions/citabot-mercadopago-subscribe/index.ts", root), "utf8"),
  readFile(new URL("supabase/functions/citabot-commercial-sync/index.ts", root), "utf8"),
  readFile(new URL("supabase/functions/citabot-mercadopago-webhook/index.ts", root), "utf8"),
  readFile(new URL("supabase/functions/_shared/citabot-payment-validation.ts", root), "utf8"),
  readFile(new URL("supabase/functions/citabot-commercial-checkout/index.ts", root), "utf8"),
]);

assert.match(validation, /export function hasCurrentPaidSubscriptionPeriod\(/);
assert.match(subscribe, /confirmed_subscription_invoice_lookup/);
assert.match(subscribe, /hasCurrentPaidSubscriptionPeriod\(/);
assert.match(subscribe, /awaiting_first_invoice:true|awaiting_first_invoice: true/);
assert.match(sync, /commercial_subscription_invoice_lookup/);
assert.match(sync, /hasCurrentPaidSubscriptionPeriod\(/);
assert.match(validation, /export function resolveCurrentSubscriptionPeriodEnd\(/);
assert.match(sync, /resolveCurrentSubscriptionPeriodEnd\(/);
assert.match(webhook, /resolveCurrentSubscriptionPeriodEnd\(/);
assert.doesNotMatch(sync, /auto_recurring\?\.end_date/);
assert.doesNotMatch(webhook, /auto_recurring\?\.end_date/);

// A preapproval lookup or retry is not an invoice receipt and cannot extend access.
const checkoutPreapprovalLookup = checkout.slice(
  checkout.indexOf("async function checkPreapproval"),
  checkout.indexOf("async function cancelAndVerifyPreapproval")
);
assert.doesNotMatch(checkoutPreapprovalLookup, /next_payment_date|currentPeriodEnd/);
const checkoutPremiumRecovery = checkout.slice(
  checkout.indexOf('if(prior?.provider_subscription_id&&prior.plan==="premium"'),
  checkout.indexOf("let reconciliationId")
);
assert.doesNotMatch(checkoutPremiumRecovery, /next_payment_date|currentPeriodEnd/,
  "Premium recovery must rely on the already persisted paid period, not the next scheduled charge.");
assert.match(checkoutPremiumRecovery, /Boolean\(paidInvoice\.data\?\.id\) && prior\.status==="active"/);
assert.match(checkoutPremiumRecovery, /typeof prior\.current_period_end==="string" \? prior\.current_period_end : null/);
assert.match(checkout, /const row=\{[\s\S]{0,500}status:"pending"[\s\S]{0,400}current_period_end:null/);

const subscribePreapprovalLookup = subscribe.slice(
  subscribe.indexOf("async function checkPreapproval"),
  subscribe.indexOf("async function cancelAndVerifyPreapproval")
);
assert.doesNotMatch(subscribePreapprovalLookup, /next_payment_date|nextPaymentDate/);
assert.doesNotMatch(subscribe, /remote\.nextPaymentDate/,
  "Professional retry must not use the next scheduled payment date as paid-period evidence.");
assert.match(subscribe, /Boolean\(paidInvoice\.data\?\.id\) && prior\.status === "active"/);
assert.match(subscribe, /typeof prior\.current_period_end === "string" \? prior\.current_period_end : null/);
assert.match(subscribe, /const row = \{[\s\S]{0,500}status: "pending"[\s\S]{0,400}current_period_end: null/);

const commercialSubscriptionRefresh = sync.slice(
  sync.indexOf('if (sub.data?.provider === "mercadopago"'),
  sync.indexOf("if (sub.data.status !== status)")
);
assert.doesNotMatch(commercialSubscriptionRefresh, /remote\?\.next_payment_date/);
assert.match(commercialSubscriptionRefresh, /Boolean\(paidInvoice\.data\?\.id\) && sub\.data\.status === "active"/);
assert.match(commercialSubscriptionRefresh, /resolveCurrentSubscriptionPeriodEnd\(\s*null,\s*sub\.data\.current_period_end/s);

const preapprovalRefresh = webhook.slice(
  webhook.indexOf("async function syncSubscription"),
  webhook.indexOf("async function syncAuthorizedPayment")
);
assert.doesNotMatch(preapprovalRefresh, /next_payment_date/,
  "A preapproval status event must not extend a paid period without a new invoice.");
assert.match(preapprovalRefresh, /Boolean\(paidInvoice\?\.id\) && local\.status==="active"/);
assert.match(preapprovalRefresh, /resolveCurrentSubscriptionPeriodEnd\(\s*null,\s*local\.current_period_end/s);

const authorizedInvoiceWebhook = webhook.slice(
  webhook.indexOf("async function syncAuthorizedPayment"),
  webhook.indexOf("async function syncPayment")
);
assert.ok(authorizedInvoiceWebhook.includes("hasCurrentPaidSubscriptionPeriod("),
  "An approved authorized-payment invoice must not activate without a verified current period.");
assert.ok(authorizedInvoiceWebhook.includes("current_period_end:currentPeriodEnd"),
  "The authorized invoice must persist only the resolved billing period.");
assert.match(authorizedInvoiceWebhook, /providerPreapproval\?\.next_payment_date/,
  "The approved invoice handler may use the provider's next period boundary after verifying that invoice.");

const authorizedSubscribe = subscribe.slice(
  subscribe.indexOf('if (remote.status === "authorized")'),
  subscribe.indexOf('if (remote.status === "pending"')
);
assert.ok(authorizedSubscribe.includes("hasCurrentPaidSubscriptionPeriod("));
assert.ok(authorizedSubscribe.includes("confirmed_subscription_invoice_lookup"));
assert.ok(authorizedSubscribe.indexOf('status: "active"') > authorizedSubscribe.indexOf("hasCurrentPaidSubscriptionPeriod("),
  "Professional reactivation must require an approved ledger invoice and a current period first.");

const authorizedSync = sync.slice(
  sync.indexOf('if (status === "active" && matchesSubscriptionConfiguration'),
  sync.indexOf("if (sub.data.status !== status)")
);
assert.ok(authorizedSync.includes("hasCurrentPaidSubscriptionPeriod("));
assert.ok(authorizedSync.includes("commercial_subscription_invoice_lookup"));
assert.ok(authorizedSync.includes('? "past_due"') && authorizedSync.includes(': "pending"'),
  "Missing invoices must keep an unexpired subscription pending and an expired period past_due.");

assert.match(webhook, /provider_reference:sub\?\.provider_subscription_id/);
const genericPaymentWebhook = webhook.slice(
  webhook.indexOf("async function syncPayment"),
  webhook.indexOf("Deno.serve")
);
assert.ok(genericPaymentWebhook.includes("hasCurrentPaidSubscriptionPeriod("),
  "The generic payment event must also require a current paid period before activation.");

console.log("CitaBot subscription activation requires exact provider configuration plus a verified current paid period: OK");
