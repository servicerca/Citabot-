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

// Checkout must never confuse contract end with the next paid billing-period boundary.
assert.match(
  checkout,
  /currentPeriodEnd:\s*typeof data\?\.next_payment_date === "string"/,
  "Checkout must source the billing-period end only from Mercado Pago's next_payment_date."
);
const checkoutCode = checkout.replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(
  checkoutCode,
  /auto_recurring\?\.end_date|auto_recurring\.end_date|end_date:\s*unknown/,
  "Checkout must not use the contract end as proof of a paid billing period."
);

const authorizedInvoiceWebhook = webhook.slice(
  webhook.indexOf("async function syncAuthorizedPayment"),
  webhook.indexOf("async function syncPayment")
);
assert.ok(authorizedInvoiceWebhook.includes("hasCurrentPaidSubscriptionPeriod("),
  "An approved authorized-payment invoice must not activate without a verified current period.");
assert.ok(authorizedInvoiceWebhook.includes("current_period_end:currentPeriodEnd"),
  "The authorized invoice must persist only the resolved billing period.");

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
