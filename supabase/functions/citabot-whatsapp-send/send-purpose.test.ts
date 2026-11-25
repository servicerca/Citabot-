import { validateWhatsAppSendPurpose } from "./send-purpose.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("acepta únicamente el propósito explícito de respuesta de servicio", () => {
  const result = validateWhatsAppSendPurpose("service");
  assert(result.ok, "Una respuesta de servicio identificada explícitamente debe aceptarse.");
  assert(result.purpose === "service", "El propósito resuelto debe seguir siendo service.");
});

Deno.test("bloquea el propósito marketing mientras no haya consentimiento verificable", () => {
  const result = validateWhatsAppSendPurpose("marketing");
  assert(!result.ok, "Marketing debe quedar bloqueado.");
  assert(result.status === 403, "La ausencia del sistema de consentimiento debe ser una denegación.");
  assert(result.code === "WHATSAPP_MARKETING_CONSENT_REQUIRED", "Debe devolver el código estable de consentimiento faltante.");
});

Deno.test("rechaza llamadas heredadas sin propósito en vez de asumir servicio", () => {
  for (const value of [undefined, null, "", "service_reply", "Marketing", {}, 1]) {
    const result = validateWhatsAppSendPurpose(value);
    assert(!result.ok, "Un propósito ausente o desconocido no puede enviarse.");
    assert(result.status === 400, "El propósito inválido debe ser un error de entrada.");
    assert(result.code === "WHATSAPP_SEND_PURPOSE_REQUIRED", "Debe exigir que el cliente etiquete el propósito.");
  }
});


Deno.test("exige una referencia UUID al mensaje entrante para respuestas de servicio", async () => {
  const { validateWhatsAppServiceReplyReference } = await import("./send-purpose.ts");
  const validId = "00000000-0000-4000-8000-000000000001";
  const result = validateWhatsAppServiceReplyReference(validId);
  assert(result.ok, "Una referencia UUID válida debe aceptarse.");
  assert(result.id === validId, "Debe devolver la referencia exacta.");
  for (const value of [undefined, null, "", "not-a-uuid", 10]) {
    const invalid = validateWhatsAppServiceReplyReference(value);
    assert(!invalid.ok, "Una referencia ausente o inválida debe rechazarse.");
    assert(invalid.code === "WHATSAPP_SERVICE_REPLY_REQUIRED", "Debe devolver el código estable.");
  }
});

Deno.test("solo permite responder al último mensaje entrante comprobado por el servidor", async () => {
  const { matchesLatestInboundReply } = await import("./send-purpose.ts");
  const latestId = "00000000-0000-4000-8000-000000000002";
  assert(matchesLatestInboundReply(latestId, latestId), "Debe aceptar la referencia al último inbound.");
  assert(!matchesLatestInboundReply(latestId, "00000000-0000-4000-8000-000000000003"), "Debe rechazar referencias obsoletas.");
  assert(!matchesLatestInboundReply(latestId, null), "Debe rechazar cuando ya no existe un inbound verificable.");
});
