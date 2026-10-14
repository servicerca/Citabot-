import { canSyncBoostOrderStatus, matchesBoostOrderPayment } from "./payment-validation.ts";

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
