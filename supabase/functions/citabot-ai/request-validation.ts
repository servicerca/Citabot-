const BUSINESS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INPUT_LENGTH = 6000;
const MAX_CONTEXT_LENGTH = 12000;

export type ValidatedAiRequest = {
  ok: true;
  businessId: string;
  input: string;
  serializedContext: string;
};

export type AiRequestValidation =
  | ValidatedAiRequest
  | { ok: false; status: 400 | 413; error: string };

export function validateAiRequest(value: unknown): AiRequestValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: 400, error: "El cuerpo de la solicitud no es válido." };
  }

  const body = value as Record<string, unknown>;
  const rawBusinessId = body.business_id;
  const businessId = typeof rawBusinessId === "string" ? rawBusinessId.trim() : "";

  if (!businessId) {
    return { ok: false, status: 400, error: "Falta business_id" };
  }
  if (!BUSINESS_ID_PATTERN.test(businessId)) {
    return { ok: false, status: 400, error: "El identificador del negocio no es válido." };
  }

  const rawInput = body.input ?? body.prompt ?? body.question ?? "";
  if (typeof rawInput !== "string") {
    return { ok: false, status: 400, error: "El texto de solicitud no es válido." };
  }

  const input = rawInput.trim();
  if (!input) {
    return { ok: false, status: 400, error: "Falta input" };
  }
  if (input.length > MAX_INPUT_LENGTH) {
    return {
      ok: false,
      status: 413,
      error: "La solicitud supera el límite de 6000 caracteres.",
    };
  }

  let serializedContext = "";
  if (body.context) {
    try {
      serializedContext = JSON.stringify(body.context) ?? "";
    } catch {
      return { ok: false, status: 400, error: "El contexto no es válido." };
    }
  }
  if (serializedContext.length > MAX_CONTEXT_LENGTH) {
    return {
      ok: false,
      status: 413,
      error: "El contexto supera el límite permitido.",
    };
  }

  return { ok: true, businessId, input, serializedContext };
}
