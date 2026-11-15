import {
  createCitabotAiBusinessRateLimitKey,
  createCitabotAiPlatformRateLimitKey,
  createCitabotAiRateLimitKeys,
  createCitabotAiUserRateLimitKey,
} from "./ai-rate-limit.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("AI rate-limit keys are stable, hashed and scoped by business", async () => {
  const a = await createCitabotAiBusinessRateLimitKey("BUSINESS-A");
  const aAgain = await createCitabotAiBusinessRateLimitKey("business-a");
  const b = await createCitabotAiBusinessRateLimitKey("business-b");
  assert(a === aAgain, "Normalized business IDs must produce a stable key.");
  assert(a !== b, "Different businesses must not share a daily bucket.");
  assert(/^[0-9a-f]{64}$/.test(a), "Rate keys must be SHA-256 hex digests.");
});

Deno.test("AI user rate-limit keys are isolated from other businesses and users", async () => {
  const a = await createCitabotAiUserRateLimitKey("business-a", "user-a");
  const same = await createCitabotAiUserRateLimitKey("BUSINESS-A", "USER-A");
  const otherUser = await createCitabotAiUserRateLimitKey("business-a", "user-b");
  const otherBusiness = await createCitabotAiUserRateLimitKey("business-b", "user-a");
  assert(a === same, "Normalized IDs must produce stable user keys.");
  assert(a !== otherUser, "Different users must not share a short-window bucket.");
  assert(a !== otherBusiness, "A user in another business must have a separate bucket.");
});

Deno.test("combined AI rate-limit keys share the business bucket but isolate users", async () => {
  const first = await createCitabotAiRateLimitKeys("business-a", "user-a");
  const second = await createCitabotAiRateLimitKeys("business-a", "user-b");
  assert(first.businessKey === second.businessKey, "All AI channels for one business must share the daily budget.");
  assert(first.userKey !== second.userKey, "Different users must have separate short-window limits.");
});

Deno.test("AI rate-limit keys reject empty identifiers", async () => {
  let businessRejected = false;
  let userRejected = false;
  try { await createCitabotAiBusinessRateLimitKey(" "); } catch { businessRejected = true; }
  try { await createCitabotAiUserRateLimitKey("business-a", " "); } catch { userRejected = true; }
  assert(businessRejected, "An empty business ID must not create a shared rate bucket.");
  assert(userRejected, "An empty user ID must not create a shared user bucket.");
});


Deno.test("the platform AI daily quota is shared across every business and channel", async () => {
  const first = await createCitabotAiPlatformRateLimitKey();
  const second = await createCitabotAiPlatformRateLimitKey();
  const business = await createCitabotAiBusinessRateLimitKey("business-a");
  assert(first === second, "The platform daily cap must be a single stable bucket.");
  assert(first !== business, "The platform cap must not reuse a tenant's bucket.");
  assert(/^[0-9a-f]{64}$/.test(first), "The platform rate key must be a SHA-256 digest.");
});
