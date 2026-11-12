import { decideAiQuota } from "./ai-usage-policy.ts";

Deno.test("la IA queda bloqueada si no existe configuración activa", () => {
  const result = decideAiQuota({ allowed: false, reason: "not_configured" }, null);
  if (result.allowed || result.code !== "AI_QUOTA_NOT_CONFIGURED" || result.status !== 503) {
    throw new Error("La configuración ausente debe bloquear el proveedor.");
  }
});

Deno.test("el límite mensual devuelve 429 sin llamar al proveedor", () => {
  const result = decideAiQuota({ allowed: false, reason: "monthly_limit" }, null);
  if (result.allowed || result.code !== "AI_MONTHLY_LIMIT_REACHED" || result.status !== 429) {
    throw new Error("El límite mensual debe bloquear nuevas solicitudes.");
  }
});

Deno.test("los errores de cuota fallan cerrados", () => {
  const result = decideAiQuota(null, new Error("database unavailable"));
  if (result.allowed || result.code !== "AI_QUOTA_UNAVAILABLE" || result.status !== 503) {
    throw new Error("Una indisponibilidad de cuotas no debe habilitar la IA.");
  }
});

Deno.test("una reserva autorizada permite continuar", () => {
  const result = decideAiQuota({ allowed: true, remaining: 3, used: 1, limit: 4, max_output_tokens: 300 }, null);
  if (!result.allowed) throw new Error("La reserva válida debe permitir continuar.");
});

Deno.test("la configuración de salida debe respetar el máximo seguro", () => {
  const result = decideAiQuota({ allowed: true, max_output_tokens: 999 }, null);
  if (result.allowed || result.code !== "AI_QUOTA_UNAVAILABLE") {
    throw new Error("La cuota debe bloquear configuraciones de salida fuera de rango.");
  }
});

Deno.test("el límite mensual global bloquea llamadas incluso para un segundo negocio", () => {
  const result = decideAiQuota({ allowed: false, reason: "global_monthly_limit" }, null);
  if (result.allowed || result.code !== "AI_MONTHLY_LIMIT_REACHED" || result.status !== 429) {
    throw new Error("El límite global debe detener nuevas solicitudes.");
  }
});

Deno.test("la falta de límite global también desactiva el proveedor", () => {
  const result = decideAiQuota({ allowed: false, reason: "global_not_configured" }, null);
  if (result.allowed || result.code !== "AI_QUOTA_NOT_CONFIGURED") {
    throw new Error("El tope global sin configurar debe fallar cerrado.");
  }
});
