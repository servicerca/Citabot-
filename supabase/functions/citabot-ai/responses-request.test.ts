import { buildResponsesRequest, CITABOT_AI_INSTRUCTIONS } from "./responses-request.ts";

Deno.test("mantiene las instrucciones confiables separadas del contenido del negocio", () => {
  const payload = buildResponsesRequest(
    "gpt-5-mini",
    "Barbería Central",
    '{"timezone":"America/Bogota"}',
    "Organiza mi agenda.",
  );

  if (payload.instructions !== CITABOT_AI_INSTRUCTIONS) {
    throw new Error("Las instrucciones internas deben enviarse en el campo instructions.");
  }
  if (payload.input.includes(CITABOT_AI_INSTRUCTIONS)) {
    throw new Error("Las instrucciones internas no deben concatenarse con el texto del usuario.");
  }
  if (!payload.input.includes("Barbería Central") ||
      !payload.input.includes("America/Bogota") ||
      !payload.input.includes("Organiza mi agenda.")) {
    throw new Error("El contenido validado del negocio debe permanecer en input.");
  }
  if (payload.max_output_tokens !== 300 || payload.model !== "gpt-5-mini") {
    throw new Error("No se conservaron los límites de generación esperados.");
  }
});
