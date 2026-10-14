export type ProviderBoostPayment = {
  status?: unknown;
  transaction_amount?: unknown;
  currency_id?: unknown;
};

export type BoostOrderExpectation = {
  amount?: unknown;
  currency?: unknown;
};

function toMinorUnits(value: unknown): number | null {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

/**
 * Compare the provider's authoritative payment response to our own order.
 * Payment signature validation alone does not prove the exact product price
 * or currency was received.
 */
export function matchesBoostOrderPayment(
  payment: ProviderBoostPayment,
  order: BoostOrderExpectation,
): boolean {
  const paidCurrency =
    typeof payment.currency_id === "string"
      ? payment.currency_id.trim().toUpperCase()
      : "";
  const orderCurrency =
    typeof order.currency === "string"
      ? order.currency.trim().toUpperCase()
      : "";
  const paidAmount = toMinorUnits(payment.transaction_amount);
  const expectedAmount = toMinorUnits(order.amount);

  return payment.status === "approved"
    && orderCurrency.length > 0
    && paidCurrency === orderCurrency
    && paidAmount !== null
    && expectedAmount !== null
    && paidAmount === expectedAmount;
}
