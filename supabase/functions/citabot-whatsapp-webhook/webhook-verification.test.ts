import { assertEquals } from "jsr:@std/assert@1";
import { validateWhatsAppWebhookChallenge } from "./webhook-verification.ts";

Deno.test("accepts only Meta subscribe challenge with the configured token", () => {
  assertEquals(
    validateWhatsAppWebhookChallenge("subscribe", "citabot-verify-secret", "challenge-123", "citabot-verify-secret"),
    { ok: true, challenge: "challenge-123" },
  );
});

Deno.test("rejects an incorrect mode, token, or empty challenge", () => {
  assertEquals(
    validateWhatsAppWebhookChallenge("unsubscribe", "citabot-verify-secret", "challenge-123", "citabot-verify-secret"),
    { ok: false, reason: "invalid_challenge" },
  );
  assertEquals(
    validateWhatsAppWebhookChallenge("subscribe", "wrong-token", "challenge-123", "citabot-verify-secret"),
    { ok: false, reason: "invalid_challenge" },
  );
  assertEquals(
    validateWhatsAppWebhookChallenge("subscribe", "citabot-verify-secret", "", "citabot-verify-secret"),
    { ok: false, reason: "invalid_challenge" },
  );
});

Deno.test("fails explicitly when server verify token is not configured", () => {
  assertEquals(
    validateWhatsAppWebhookChallenge("subscribe", "anything", "challenge-123", ""),
    { ok: false, reason: "verify_token_not_configured" },
  );
});
