export type WebhookChallengeResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: "verify_token_not_configured" | "invalid_challenge" };

function constantTimeEquals(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

export function validateWhatsAppWebhookChallenge(
  mode: string | null,
  receivedToken: string | null,
  challenge: string | null,
  expectedToken: string | null | undefined,
): WebhookChallengeResult {
  const expected = String(expectedToken || "");
  if (!expected) return { ok: false, reason: "verify_token_not_configured" };
  if (mode !== "subscribe" || !receivedToken || !challenge) {
    return { ok: false, reason: "invalid_challenge" };
  }
  if (!constantTimeEquals(receivedToken, expected)) {
    return { ok: false, reason: "invalid_challenge" };
  }
  return { ok: true, challenge };
}
