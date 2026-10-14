import { matchesBoostOrderPayment } from "./payment-validation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const order = { amount: 5000, currency: "COP" };

Deno.test("accepts an approved payment matching the stored order", () => {
  assert(matchesBoostOrderPayment(
    { status: "approved", transaction_amount: 5000, currency_id: "COP" },
    order,
  ), "Exact approved COP payment should match.");
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
      { amount, currency: "COP" },
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
