import { fetchAllPages, type PageResult } from "./pagination.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}; esperado ${JSON.stringify(expected)}, recibido ${JSON.stringify(actual)}`);
  }
}

Deno.test("fetchAllPages recoge todas las páginas sin perder filas", async () => {
  const source = [1, 2, 3, 4, 5];
  const ranges: Array<[number, number]> = [];
  const result = await fetchAllPages<number>(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  }, { pageSize: 2 });
  assertEqual(result, source, "No se devolvieron todas las filas en orden");
  assertEqual(ranges, [[0, 1], [2, 3], [4, 5]], "Los rangos no son contiguos");
});

Deno.test("fetchAllPages acepta conjuntos vacíos y resultados menores que una página", async () => {
  const empty = await fetchAllPages<number>(async () => ({ data: [], error: null }), { pageSize: 2 });
  assertEqual(empty, [], "El resultado vacío no se conservó");

  const rows = await fetchAllPages<number>(async () => ({ data: [7], error: null }), { pageSize: 2 });
  assertEqual(rows, [7], "No se devolvió la última página");
});

Deno.test("fetchAllPages propaga errores de PostgREST", async () => {
  const marker = new Error("database unavailable");
  let thrown: unknown;
  try {
    await fetchAllPages<number>(async () => ({ data: null, error: marker }));
  } catch (error) {
    thrown = error;
  }
  assert(thrown === marker, "El error de la consulta quedó oculto");
});

Deno.test("fetchAllPages no devuelve resultados silenciosamente truncados", async () => {
  let thrown: unknown;
  try {
    await fetchAllPages<number>(async () => ({ data: [1], error: null }), {
      pageSize: 1,
      maxPages: 2,
    });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error && thrown.message === "pagination_safety_limit_exceeded",
    "No se rechazó el límite de seguridad");
});

Deno.test("fetchAllPages rechaza parámetros de paginación inválidos", async () => {
  let pageSizeError: unknown;
  try {
    await fetchAllPages<number>(async () => ({ data: [], error: null }), { pageSize: 0 });
  } catch (error) {
    pageSizeError = error;
  }
  assert(pageSizeError instanceof Error && pageSizeError.message === "invalid_page_size",
    "No se rechazó el tamaño de página inválido");
});
