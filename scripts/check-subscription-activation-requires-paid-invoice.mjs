import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [subscribe, sync, validation] = await Promise.all([
  readFile(new URL("supabase/functions/citabot-mercadopago-subscribe/index.ts", root), "utf8"),
  readFile(new URL("supabase/functions/citabot-commercial-sync/index.ts", root), "utf8"),
  readFile(new URL("supabase/functions/_shared/citabot-payment-validation.ts", root), "utf8"),
]);

assert.match(validation, /export function hasCurrentPaidSubscriptionPeriod\(/);
assert.match(subscribe, /confirmed_subscription_invoice_lookup/);
assert.match(subscribe, /hasCurrentPaidSubscriptionPeriod\(/);
assert.match(subscribe, /awaiting_first_invoice:true|awaiting_first_invoice: true/);
assert.match(sync, /commercial_subscription_invoice_lookup/);
assert.match(sync, /hasCurrentPaidSubscriptionPeriod\(/);

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
assert.ok(authorizedSync.includes('status = "pending"') || authorizedSync.includes('status = "past_due"'));

console.log("CitaBot subscription activation requires exact provider configuration plus a paid current-period ledger entry: OK");
