export const CITABOT_AI_USER_LIMIT = 6;
export const CITABOT_AI_USER_WINDOW_SECONDS = 300;
export const CITABOT_AI_BUSINESS_LIMIT = 25;
export const CITABOT_AI_BUSINESS_WINDOW_SECONDS = 24 * 60 * 60;

async function hashRateKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Namespaced, non-reversible rate-limit keys. The business key is shared by the
 * authenticated AI endpoint and WhatsApp auto-replies, so both channels spend
 * from one conservative daily request allowance without storing user IDs.
 */
export async function createCitabotAiBusinessRateLimitKey(businessId: string): Promise<string> {
  const normalized = typeof businessId === "string" ? businessId.trim().toLowerCase() : "";
  if (!normalized) throw new Error("AI_BUSINESS_RATE_KEY_REQUIRED");
  return await hashRateKey("citabot-ai:business:" + normalized);
}

export async function createCitabotAiUserRateLimitKey(
  businessId: string,
  userId: string,
): Promise<string> {
  const business = typeof businessId === "string" ? businessId.trim().toLowerCase() : "";
  const user = typeof userId === "string" ? userId.trim().toLowerCase() : "";
  if (!business || !user) throw new Error("AI_USER_RATE_KEY_REQUIRED");
  return await hashRateKey("citabot-ai:user:" + business + ":" + user);
}

export async function createCitabotAiRateLimitKeys(businessId: string, userId: string) {
  const [businessKey, userKey] = await Promise.all([
    createCitabotAiBusinessRateLimitKey(businessId),
    createCitabotAiUserRateLimitKey(businessId, userId),
  ]);
  return { businessKey, userKey };
}
