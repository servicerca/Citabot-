import { SUBSCRIPTION_MONTHLY_PRICES_COP } from "../_shared/citabot-pricing.ts";

export type ProviderBoostPayment = {
  status?: unknown;
  transaction_amount?: unknown;
  currency_id?: unknown;
};

export type BoostOrderExpectation = {
  amount?: unknown;
  currency?: unknown;
  status?: unknown;
};

export type ProviderSubscriptionPayment = {
  status?: unknown;
  transaction_amount?: unknown;
  currency_id?: unknown;
};

export type ProviderSubscriptionConfiguration = {
  status?: unknown;
  auto_recurring?: {
    frequency?: unknown;
    frequency_type?: unknown;
    transaction_amount?: unknown;
    currency_id?: unknown;
  } | null;
};

const BOOST_ORDER_STATUSES = new Set([
  "pending",
  "paid",
  "failed",
  "cancelled",
  "expired",
  "refunded",
]);

const subscriptionPriceLookup: Readonly<Record<string, number>> = SUBSCRIPTION_MONTHLY_PRICES_COP;

function expectedSubscriptionPrice(plan: unknown): number | null {
  if (typeof plan !== "string") return null;
  return subscriptionPriceLookup[plan] ?? null;
}

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
 * Subscription activation requires the exact server-configured monthly price
 * for the plan and an explicit COP currency from Mercado Pago's authoritative
 * payment response. A valid webhook signature alone does not prove price.
 */
export function matchesSubscriptionPayment(
  payment: ProviderSubscriptionPayment,
  plan: unknown,
): boolean {
  const expectedAmount = expectedSubscriptionPrice(plan);
  const paidCurrency =
    typeof payment.currency_id === "string"
      ? payment.currency_id.trim().toUpperCase()
      : "";
  const paidAmount = toMinorUnits(payment.transaction_amount);

  return payment.status === "approved"
    && expectedAmount !== null
    && paidCurrency === "COP"
    && paidAmount !== null
    && paidAmount === Math.round(expectedAmount * 100);
}



/**
 * An "authorized" preapproval can activate a plan before the first invoice
 * arrives. Validate the provider's recurring configuration too, so a signed
 * notification cannot activate a different price, currency or billing cadence.
 */
export function matchesSubscriptionConfiguration(
  preapproval: ProviderSubscriptionConfiguration,
  plan: unknown,
): boolean {
  const expectedAmount = expectedSubscriptionPrice(plan);
  const recurring = preapproval.auto_recurring;
  const configuredCurrency = typeof recurring?.currency_id === "string"
    ? recurring.currency_id.trim().toUpperCase()
    : "";
  const configuredAmount = toMinorUnits(recurring?.transaction_amount);

  return preapproval.status === "authorized"
    && expectedAmount !== null
    && recurring?.frequency === 1
    && recurring?.frequency_type === "months"
    && configuredCurrency === "COP"
    && configuredAmount !== null
    && configuredAmount === Math.round(expectedAmount * 100);
}

/**
 * Reject out-of-order provider updates that would resurrect a terminal order
 * or downgrade a paid/refunded order. Provider notifications are retried and
 * may arrive after a cancellation, expiration, or refund.
 */
export function canSyncBoostOrderStatus(
  currentStatus: unknown,
  incomingStatus: unknown,
): boolean {
  if (
    typeof currentStatus !== "string"
    || typeof incomingStatus !== "string"
    || !BOOST_ORDER_STATUSES.has(currentStatus)
    || !BOOST_ORDER_STATUSES.has(incomingStatus)
  ) return false;

  if (currentStatus === "pending") return true;
  if (currentStatus === "paid") return incomingStatus === "paid" || incomingStatus === "refunded";
  if (currentStatus === "refunded") return incomingStatus === "refunded";

  // Failed/cancelled/expired orders are terminal. A confirmed refund may still
  // need to be recorded, but a late approval must never activate an entitlement.
  return incomingStatus === currentStatus || incomingStatus === "refunded";
}

/**
 * Compare the provider's authoritative payment response to our own order.
 * Payment signature validation alone does not prove the exact product price
 * or currency was received. Only pending/already-paid orders may be activated
 * idempotently; terminal orders require reconciliation instead.
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
  const orderStateEligible = order.status === "pending" || order.status === "paid";

  return payment.status === "approved"
    && orderStateEligible
    && orderCurrency.length > 0
    && paidCurrency === orderCurrency
    && paidAmount !== null
    && expectedAmount !== null
    && paidAmount === expectedAmount;
}
