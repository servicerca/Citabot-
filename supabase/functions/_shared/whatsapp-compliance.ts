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

/**
 * Meta's WhatsApp Cloud API sends messages[].timestamp as Unix seconds.
 * Return null for malformed or future timestamps so an invalid clock value
 * can never open the free-form messaging window.
 */
export function parseWhatsAppProviderTimestamp(
  value: unknown,
  nowMs = Date.now(),
): string | null {
  const seconds =
    typeof value === "string" && /^\d{9,11}$/.test(value)
      ? Number(value)
      : typeof value === "number" && Number.isSafeInteger(value)
        ? value
        : Number.NaN;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;

  const timestampMs = seconds * 1000;
  if (!Number.isFinite(timestampMs) || timestampMs > nowMs) return null;

  const parsed = new Date(timestampMs);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
