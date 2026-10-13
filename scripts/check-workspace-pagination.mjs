import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

assert.match(html, /async function cbFetchAllPages\(makeQuery,pageSize=500,maxPages=200\)/,
  "El espacio de trabajo debe usar paginación explícita y acotada.");

for (const table of [
  "services",
  "staff",
  "customers",
  "appointments",
  "campaigns",
  "payments",
  "business_hours",
  "business_promotions",
  "directory_boost_orders",
  "platform_revenue",
]) {
  const query = new RegExp(
    `cbFetchAllPages\\(\\(from,to\\)=>sb\\.from\\('${table}'\\)[^;]{0,700}?\\.range\\(from,to\\)`,
  );
  assert.match(html, query,
    `La consulta de ${table} debe recuperar páginas completas y ordenar de forma estable.`);
}

assert.match(
  html,
  /sb\.from\('messages'\)\.select\('\*'\)\.eq\('business_id',bid\)\.order\('created_at',\{ascending:false\}\)\.order\('id',\{ascending:false\}\)\.limit\(200\)/,
  "El historial debe cargar los 200 mensajes más recientes, no los primeros 200 antiguos.",
);
assert.match(
  html,
  /messages:\(m\.data\|\|\[\]\)\.slice\(\)\.reverse\(\)/,
  "Los mensajes recientes deben mostrarse en orden cronológico.",
);
assert.match(
  html,
  /if\(\(overflow\|\|\[\]\)\.length\)throw new Error\('Este negocio supera el límite seguro de 100\.000 registros por consulta\. No se mostrarán totales parciales\.'\)/,
  "La app debe fallar explícitamente en vez de mostrar agregados parciales por encima del límite.",
);

console.log("CitaBot workspace pagination guard: OK (10 paginated tables; recent messages; fail-closed safety cap).");
