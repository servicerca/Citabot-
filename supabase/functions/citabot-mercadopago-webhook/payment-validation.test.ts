import {
  canSyncBoostOrderStatus,
  matchesBoostOrderPayment,
  matchesSubscriptionConfiguration,
  matchesSubscriptionPayment,
  matchesSubscriptionActivation,
  hasCurrentPaidSubscriptionPeriod,
} from "./payment-validation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const order = { amount: 5000, currency: "COP", status: "pending" };
const exactPayment = { status: "approved", transaction_amount: 5000, currency_id: "COP" };

Deno.test("accepts an approved payment matching the stored order", () => {
  assert(matchesBoostOrderPayment(exactPayment, order), "Exact approved COP payment should match.");
});

Deno.test("allows idempotent replays for an already-paid order", () => {
  assert(
    matchesBoostOrderPayment(exactPayment, { ...order, status: "paid" }),
    "A duplicate approved notification for a paid order must be safe to retry.",
  );
  assert(canSyncBoostOrderStatus("paid", "paid"), "Paid-to-paid is an idempotent replay.");
});

Deno.test("rejects underpayments and overpayments", () => {
  assert(!matchesBoostOrderPayment(
    { status: "approved", transaction_amount: 4999, currency_id: "COP" },
    order,
  ), "Underpayment must not activate a boost.");
  assert(!matchesBoostOrderPayment(
    { status: "approved", transaction_amount: 5001, currency_id: "COP" },
    order,
  ), "Overpayment must be reconciled rather than silently activating.");
});

Deno.test("rejects a different or missing currency", () => {
  assert(!matchesBoostOrderPayment(
    { status: "approved", transaction_amount: 5000, currency_id: "USD" },
    order,
  ), "Different currency must not activate a boost.");
  assert(!matchesBoostOrderPayment(
    { status: "approved", transaction_amount: 5000 },
    order,
  ), "Missing currency must fail closed.");
});

Deno.test("requires provider status approved", () => {
  assert(!matchesBoostOrderPayment(
    { status: "pending", transaction_amount: 5000, currency_id: "COP" },
    order,
  ), "Pending payment must not match a paid order.");
});

Deno.test("rejects invalid or non-positive amounts", () => {
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "not-a-number", ""]) {
    assert(!matchesBoostOrderPayment(
      { status: "approved", transaction_amount: 5000, currency_id: "COP" },
      { ...order, amount },
    ), "Invalid expected amount must fail closed.");
    assert(!matchesBoostOrderPayment(
      { status: "approved", transaction_amount: amount, currency_id: "COP" },
      order,
    ), "Invalid received amount must fail closed.");
  }
});

Deno.test("matches currency case-insensitively and amounts to two decimals", () => {
  assert(matchesBoostOrderPayment(
    { status: "approved", transaction_amount: "5000.00", currency_id: "cop" },
    order,
  ), "Normalized valid amounts/currency should match.");
});

Deno.test("never reactivates a failed, cancelled, expired or refunded order", () => {
  for (const status of ["failed", "cancelled", "expired", "refunded"]) {
    assert(!matchesBoostOrderPayment(exactPayment, { ...order, status }),
      status + " order must not activate after a late approved notification.");
    assert(!canSyncBoostOrderStatus(status, "paid"),
      status + " order must not transition to paid.");
  }
});

Deno.test("refunds can be recorded without allowing stale events to reverse them", () => {
  assert(canSyncBoostOrderStatus("pending", "refunded"), "A provider-confirmed refund can resolve a pending order.");
  assert(canSyncBoostOrderStatus("paid", "refunded"), "A paid order can transition to refunded.");
  assert(canSyncBoostOrderStatus("failed", "refunded"), "A confirmed refund must be recorded even after a failure state.");
  assert(canSyncBoostOrderStatus("refunded", "refunded"), "Duplicate refund notifications are safe.");
  assert(!canSyncBoostOrderStatus("refunded", "paid"), "A stale approval must not reverse a refund.");
  assert(!canSyncBoostOrderStatus("paid", "pending"), "A stale pending notification must not downgrade a paid order.");
  assert(!canSyncBoostOrderStatus("paid", "failed"), "A stale failure notification must not downgrade a paid order.");
});

Deno.test("unknown or malformed order states fail closed", () => {
  assert(!canSyncBoostOrderStatus(undefined, "paid"), "Missing stored status must be rejected.");
  assert(!canSyncBoostOrderStatus("pending", "unexpected"), "Unknown provider state must not be persisted.");
  assert(!matchesBoostOrderPayment(exactPayment, { amount: 5000, currency: "COP" }),
    "Missing stored order status must fail closed.");
});

Deno.test("accepts exact Professional and Premium subscription prices in COP", () => {
  assert(matchesSubscriptionPayment(
    { status: "approved", transaction_amount: 59900, currency_id: "COP" },
    "professional",
  ), "Professional must match COP 59,900.");
  assert(matchesSubscriptionPayment(
    { status: "approved", transaction_amount: "69900.00", currency_id: "cop" },
    "premium",
  ), "Premium must match COP 69,900.");
});

Deno.test("rejects subscription underpayment and overpayment", () => {
  for (const plan of ["professional", "premium"]) {
    const expected = plan === "professional" ? 59900 : 69900;
    assert(!matchesSubscriptionPayment(
      { status: "approved", transaction_amount: expected - 1, currency_id: "COP" },
      plan,
    ), plan + " underpayment must never activate a subscription.");
    assert(!matchesSubscriptionPayment(
      { status: "approved", transaction_amount: expected + 1, currency_id: "COP" },
      plan,
    ), plan + " overpayment must never activate a subscription.");
  }
});

Deno.test("rejects subscription payment with a missing or incorrect currency", () => {
  assert(!matchesSubscriptionPayment(
    { status: "approved", transaction_amount: 59900, currency_id: "USD" },
    "professional",
  ), "A different currency must not activate a subscription.");
  assert(!matchesSubscriptionPayment(
    { status: "approved", transaction_amount: 59900 },
    "professional",
  ), "A missing currency must fail closed; it must not default to COP.");
});

Deno.test("rejects unsupported plans, non-approved status and malformed subscription amounts", () => {
  assert(!matchesSubscriptionPayment(
    { status: "approved", transaction_amount: 59900, currency_id: "COP" },
    "free",
  ), "Free must not be activated from a provider payment.");
  assert(!matchesSubscriptionPayment(
    { status: "approved", transaction_amount: 59900, currency_id: "COP" },
    "unknown",
  ), "Unknown plans must fail closed.");
  assert(!matchesSubscriptionPayment(
    { status: "pending", transaction_amount: 59900, currency_id: "COP" },
    "professional",
  ), "Pending payments must not activate.");
  for (const amount of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "invalid", ""]) {
    assert(!matchesSubscriptionPayment(
      { status: "approved", transaction_amount: amount, currency_id: "COP" },
      "professional",
    ), "Invalid or non-positive subscription amount must fail closed.");
  }
});


Deno.test("accepts authorized monthly preapprovals matching each CitaBot plan", () => {
  assert(matchesSubscriptionConfiguration({
    status: "authorized",
    auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 59900, currency_id: "COP" },
  }, "professional"), "Professional preapproval must be COP 59,900 monthly.");
  assert(matchesSubscriptionConfiguration({
    status: "authorized",
    auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 69900, currency_id: "COP" },
  }, "premium"), "Premium preapproval must be COP 69,900 monthly.");
});

Deno.test("rejects preapprovals with a mismatched amount, currency or cadence", () => {
  const base = { status: "authorized", auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 59900, currency_id: "COP" } };
  assert(!matchesSubscriptionConfiguration({
    ...base,
    auto_recurring: { ...base.auto_recurring, transaction_amount: 59899 },
  }, "professional"), "An underpriced preapproval must not activate Professional.");
  assert(!matchesSubscriptionConfiguration({
    ...base,
    auto_recurring: { ...base.auto_recurring, transaction_amount: 59901 },
  }, "professional"), "An overpriced preapproval must be reconciled.");
  assert(!matchesSubscriptionConfiguration({
    ...base,
    auto_recurring: { ...base.auto_recurring, currency_id: "USD" },
  }, "professional"), "A foreign-currency preapproval must fail closed.");
  assert(!matchesSubscriptionConfiguration({
    ...base,
    auto_recurring: { ...base.auto_recurring, frequency: 2 },
  }, "professional"), "A different billing frequency must fail closed.");
  assert(!matchesSubscriptionConfiguration({
    ...base,
    auto_recurring: { ...base.auto_recurring, frequency_type: "days" },
  }, "professional"), "A different frequency type must fail closed.");
  assert(!matchesSubscriptionConfiguration({
    ...base,
    auto_recurring: { ...base.auto_recurring, currency_id: undefined },
  }, "professional"), "A missing currency must fail closed.");
  assert(!matchesSubscriptionConfiguration(base, "free"), "Unsupported plans must fail closed.");
  assert(!matchesSubscriptionConfiguration({
    ...base, status: "pending",
  }, "professional"), "A pending preapproval must not activate.");
});
Deno.test("subscription activation requires both the exact invoice and authorized recurring preapproval", () => {
  const payment = { status: "approved", transaction_amount: 59900, currency_id: "COP" };
  const validPreapproval = {
    status: "authorized",
    auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 59900, currency_id: "COP" },
  };
  const invalidPreapproval = {
    status: "authorized",
    auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 59800, currency_id: "COP" },
  };
  const invalidPayment = { status: "approved", transaction_amount: 59800, currency_id: "COP" };

  assert(matchesSubscriptionActivation(payment, validPreapproval, "professional"),
    "Exact invoice plus matching authorized preapproval may activate.");
  assert(!matchesSubscriptionActivation(payment, invalidPreapproval, "professional"),
    "A correct invoice must not bypass a mismatched recurring preapproval.");
  assert(!matchesSubscriptionActivation(invalidPayment, validPreapproval, "professional"),
    "A matching preapproval must not bypass an incorrect invoice.");
  assert(!matchesSubscriptionActivation(payment, null, "professional"),
    "Missing provider preapproval must fail closed.");
});


Deno.test("authorized preapproval alone never unlocks a subscription without a paid current invoice", () => {
  const now = Date.parse("2026-11-09T12:00:00.000Z");
  const future = "2026-12-09T12:00:00.000Z";
  const past = "2026-11-08T12:00:00.000Z";

  assert(hasCurrentPaidSubscriptionPeriod("authorized", true, future, now),
    "A confirmed paid invoice with a future current period may keep access active.");
  assert(!hasCurrentPaidSubscriptionPeriod("authorized", false, future, now),
    "An authorized preapproval without a paid invoice must not activate.");
  assert(!hasCurrentPaidSubscriptionPeriod("pending", true, future, now),
    "A pending preapproval must not activate.");
  assert(!hasCurrentPaidSubscriptionPeriod("authorized", true, past, now),
    "An expired paid period must not remain active.");
  assert(!hasCurrentPaidSubscriptionPeriod("authorized", true, null, now),
    "A missing period end must fail closed.");
});
