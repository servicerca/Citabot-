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
