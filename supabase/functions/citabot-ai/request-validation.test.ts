import { validateAiRequest } from "./request-validation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertRejected(
  result: ReturnType<typeof validateAiRequest>,
  status: 400 | 413,
  message: string,
): void {
  assert(!result.ok, "La solicitud debía rechazarse.");
  assert(result.status === status, `Estado esperado ${status}; recibido ${result.status}.`);
  assert(result.error === message, `Mensaje inesperado: ${result.error}`);
}

const validBusinessId = "00000000-0000-4000-8000-000000000001";

Deno.test("acepta una solicitud válida y serializa su contexto", () => {
  const result = validateAiRequest({
    business_id: validBusinessId,
    input: "  Ayúdame a organizar la agenda.  ",
    context: { timezone: "America/Bogota" },
  });
  assert(result.ok, "La solicitud válida debía aceptarse.");
  assert(result.businessId === validBusinessId, "No se conservó el identificador validado.");
  assert(result.input === "Ayúdame a organizar la agenda.", "No se normalizó el texto.");
  assert(
    result.serializedContext === '{"timezone":"America/Bogota"}',
    "No se serializó el contexto esperado.",
  );
});

Deno.test("rechaza cuerpos nulos, arrays y valores no objeto", () => {
  for (const value of [null, [], "texto", 7]) {
    assertRejected(
      validateAiRequest(value),
      400,
      "El cuerpo de la solicitud no es válido.",
    );
  }
});

Deno.test("rechaza identificadores de negocio que no son UUID", () => {
  assertRejected(
    validateAiRequest({ business_id: "negocio-1", input: "Consulta válida" }),
    400,
    "El identificador del negocio no es válido.",
  );
});

Deno.test("rechaza solicitud vacía y tipos no textuales", () => {
  assertRejected(
    validateAiRequest({ business_id: validBusinessId, input: "   " }),
    400,
    "Falta input",
  );
  assertRejected(
    validateAiRequest({ business_id: validBusinessId, input: { prompt: "texto" } }),
    400,
    "El texto de solicitud no es válido.",
  );
});

Deno.test("limita el texto de entrada para evitar consumo descontrolado", () => {
  assertRejected(
    validateAiRequest({
      business_id: validBusinessId,
      input: "x".repeat(6001),
    }),
    413,
    "La solicitud supera el límite de 6000 caracteres.",
  );
});

Deno.test("limita el contexto para evitar peticiones excesivas al proveedor", () => {
  assertRejected(
    validateAiRequest({
      business_id: validBusinessId,
      input: "Consulta válida",
      context: "x".repeat(12001),
    }),
    413,
    "El contexto supera el límite permitido.",
  );
});
