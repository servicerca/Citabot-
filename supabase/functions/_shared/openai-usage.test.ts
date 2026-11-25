import {
  buildOpenAiUsageEvent,
  estimateOpenAiCostUsd,
  extractOpenAiUsage,
  parseOpenAiRateCard,
} from "./openai-usage.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("extrae tokens Responses API y tokens de entrada en caché", () => {
  const usage = extractOpenAiUsage({
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      total_tokens: 1100,
      input_tokens_details: { cached_tokens: 250 },
    },
  });
  assert(usage?.inputTokens === 1000, "Debe leer input_tokens.");
  assert(usage.outputTokens === 100, "Debe leer output_tokens.");
  assert(usage.cachedInputTokens === 250, "Debe leer cached_tokens.");
  assert(usage.totalTokens === 1100, "Debe leer total_tokens.");
});

Deno.test("rechaza uso ausente, incompleto o incoherente", () => {
  assert(extractOpenAiUsage({}) === null, "Uso ausente debe quedar no disponible.");
  assert(extractOpenAiUsage({ usage: { input_tokens: 1 } }) === null, "Uso incompleto debe rechazarse.");
  assert(extractOpenAiUsage({ usage: { input_tokens: 2, output_tokens: 1, input_tokens_details: { cached_tokens: 3 } } }) === null,
    "Tokens en caché no pueden exceder los tokens de entrada.");
  assert(extractOpenAiUsage({ usage: { input_tokens: -1, output_tokens: 2 } }) === null, "No se aceptan contadores negativos.");
});

Deno.test("valida la tabla de precios y no inventa costos si faltan tarifas", () => {
  assert(parseOpenAiRateCard({ inputUsdPerMillion: "0.25" }) === null, "Sin precio de salida no existe estimación.");
  assert(parseOpenAiRateCard({ inputUsdPerMillion: "0.25", outputUsdPerMillion: "2" }) === null, "Sin versión de tarifa no debe estimarse el costo.");
  assert(parseOpenAiRateCard({ inputUsdPerMillion: "-1", outputUsdPerMillion: "1" }) === null, "No se admiten tarifas negativas.");
  assert(parseOpenAiRateCard({ inputUsdPerMillion: "1e-3", outputUsdPerMillion: "1" }) === null, "La tarifa debe tener formato decimal explícito.");
  const card = parseOpenAiRateCard({
    inputUsdPerMillion: "0.20",
    outputUsdPerMillion: "0.80",
    cachedInputUsdPerMillion: "0.05",
    scheduleVersion: "invoice-2026-11",
  });
  assert(card?.scheduleVersion === "invoice-2026-11", "Debe conservar la versión de precios.");
  assert(estimateOpenAiCostUsd({
    inputTokens: 1000,
    outputTokens: 100,
    totalTokens: 1100,
    cachedInputTokens: 250,
  }, card!) === 0.0002425, "Debe calcular entrada normal, entrada en caché y salida por separado.");
});

Deno.test("emite métricas por negocio sin contenido ni datos personales", () => {
  const card = parseOpenAiRateCard({ inputUsdPerMillion: "1", outputUsdPerMillion: "2", scheduleVersion: "verified-v1" });
  const event = buildOpenAiUsageEvent({
    source: "whatsapp_webhook",
    businessId: "00000000-0000-4000-8000-000000000001",
    model: "gpt-5-mini",
    requestId: "req_123.abc",
    response: { output_text: "texto privado", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    rateCard: card,
  });
  const serialized = JSON.stringify(event);
  assert(event.business_id === "00000000-0000-4000-8000-000000000001", "Debe atribuir el uso al negocio.");
  assert(event.estimated_cost_usd === 0.00002, "Debe calcular estimación con tarifas suministradas.");
  assert(event.cost_estimate_scope === "input_output_and_cached_input_only", "Debe declarar el alcance limitado de la estimación.");
  assert(event.cache_write_cost_included === false, "No debe afirmar que incluye cargos de escritura de caché.");
  assert(!serialized.includes("texto privado"), "No debe guardar contenido de la respuesta.");
  assert(!serialized.includes("prompt") && !serialized.includes("phone") && !serialized.includes("customer"),
    "No debe incluir prompts, teléfonos ni identificadores de clientes.");
});

Deno.test("uso sin tarifa registra tokens pero deja costo como null", () => {
  const event = buildOpenAiUsageEvent({
    source: "assistant",
    businessId: "00000000-0000-4000-8000-000000000001",
    model: "gpt-5-mini",
    requestId: "req_456",
    response: { usage: { input_tokens: 20, output_tokens: 10 } },
    rateCard: null,
  });
  assert(event.usage_available === true, "Debe registrar tokens aunque no haya tarifa.");
  assert(event.estimated_cost_usd === null, "Nunca debe inventar el costo sin tarifa verificada.");
});
