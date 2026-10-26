import { publicBookingRateLimitIdentity } from "./rate-limit-key.ts";

function assertEquals(actual: string, expected: string, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

Deno.test("uses the edge client IP instead of a caller-supplied X-Forwarded-For value", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.10",
    "x-forwarded-for": "198.51.100.77",
  });
  assertEquals(publicBookingRateLimitIdentity(headers), "203.0.113.10", "trusted client identity");
});

Deno.test("does not use X-Forwarded-For when the edge client IP is missing", () => {
  const headers = new Headers({ "x-forwarded-for": "198.51.100.77, 192.0.2.4" });
  assertEquals(publicBookingRateLimitIdentity(headers), "unknown", "missing trusted identity must fail closed");
});

Deno.test("rejects ambiguous edge identity instead of falling back to X-Forwarded-For", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.10, 198.51.100.77",
    "x-forwarded-for": "192.0.2.9",
  });
  assertEquals(publicBookingRateLimitIdentity(headers), "unknown", "ambiguous trusted identity must fail closed");
});

Deno.test("trims surrounding whitespace from the gateway IP", () => {
  const headers = new Headers({ "cf-connecting-ip": "  203.0.113.10  " });
  assertEquals(publicBookingRateLimitIdentity(headers), "203.0.113.10", "trimmed gateway identity");
});
