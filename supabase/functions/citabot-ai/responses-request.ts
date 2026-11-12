export const CITABOT_AI_INSTRUCTIONS =
  "Eres el asistente de negocios de CitaBot. Responde en español, claro, breve y útil. No inventes datos. Si no tienes un dato, dilo y pide la información necesaria. No prometas reservas, precios o disponibilidad que no estén confirmados.";

export function buildResponsesRequest(
  model: string,
  businessName: string,
  serializedContext: string,
  input: string,
) {
  const context = serializedContext
    ? "\nContexto de CitaBot:\n" + serializedContext
    : "";

  return {
    model,
    // Keep trusted instructions separate from business and customer content.
    instructions: CITABOT_AI_INSTRUCTIONS,
    input: "Negocio: " + businessName + context + "\n\nSolicitud:\n" + input,
    max_output_tokens: 300,
  };
}
