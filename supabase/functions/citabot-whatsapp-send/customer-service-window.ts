export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isInsideWhatsAppCustomerServiceWindow(
  lastInboundAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  const inboundMs = Date.parse(lastInboundAt);
  if (!Number.isFinite(inboundMs)) return false;
  const age = nowMs - inboundMs;
  return age >= 0 && age < CUSTOMER_SERVICE_WINDOW_MS;
}
