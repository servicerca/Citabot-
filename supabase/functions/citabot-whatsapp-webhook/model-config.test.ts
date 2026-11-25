import { resolveConfiguredOpenAiModel } from "./model-config.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("no elige silenciosamente un modelo si falta la configuración", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert(resolveConfiguredOpenAiModel(value) === null, "La configuración ausente debe activar el fallback determinista.");
  }
});

Deno.test("conserva exactamente el modelo configurado de forma explícita", () => {
  assert(resolveConfiguredOpenAiModel("gpt-5-mini") === "gpt-5-mini", "No debe cambiar automáticamente el modelo del propietario.");
  assert(resolveConfiguredOpenAiModel("gpt-6.1-terra") === "gpt-6.1-terra", "Debe aceptar identificadores actuales con puntos y guiones.");
});

Deno.test("rechaza valores malformados antes de formar una llamada al proveedor", () => {
  for (const value of ["gpt model", "x/../../other", "bad\nmodel", "a".repeat(81), 42, {}]) {
    assert(resolveConfiguredOpenAiModel(value) === null, "Un identificador no válido debe dejar la IA externa desactivada.");
  }
});
