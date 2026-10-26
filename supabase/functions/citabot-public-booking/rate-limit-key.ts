/**
 * Return only the client IP supplied by the edge gateway.
 *
 * Do not fall back to X-Forwarded-For: that header can contain client-supplied
 * values as it crosses proxies, allowing a caller to shard its rate-limit key.
 * If the trusted gateway identity is unavailable or ambiguous, fail closed to
 * a shared per-business bucket rather than trust attacker-controlled input.
 */
export function publicBookingRateLimitIdentity(headers: Headers): string {
  const ip = headers.get("cf-connecting-ip")?.trim();
  if (!ip || ip.length > 64 || /[\\s,]/.test(ip)) return "unknown";
  return ip;
}
