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

assert.match(html, /window\.loadOlderConversations=async\(\)=>/,
  "La lista de conversaciones debe poder descubrir conversaciones más antiguas sin descargar todo el historial en un único request.");
assert.match(html, /window\.loadOlderConversationMessages=async\(customerId\)=>/,
  "Cada hilo debe poder recuperar mensajes anteriores bajo demanda.");
assert.match(html, /created_at\.lt\.\$\{cursor\.created_at\},and\(created_at\.eq\.\$\{cursor\.created_at\},id\.lt\.\$\{cursor\.id\}\)/,
  "La paginación global debe usar cursor estable (created_at, id) para no saltarse mensajes.");
assert.match(html, /created_at\.lt\.\$\{oldest\.created_at\},and\(created_at\.eq\.\$\{oldest\.created_at\},id\.lt\.\$\{oldest\.id\}\)/,
  "La paginación de hilos debe usar cursor estable (created_at, id) para recuperar el historial completo.");
assert.match(html, /Cargar conversaciones anteriores/,
  "La interfaz debe ofrecer una acción visible para recuperar conversaciones fuera de la ventana inicial de 200 mensajes.");
assert.match(html, /Cargar mensajes anteriores/,
  "La interfaz debe permitir leer el historial anterior del hilo seleccionado.");
assert.match(html, /customers\.sort\(\(a,b\)=>/,
  "Las conversaciones deben ordenarse por la actividad más reciente, no por el primer mensaje de su historial.");

assert.match(
  html,
  /if\(\(overflow\|\|\[\]\)\.length\)throw new Error\('Este negocio supera el límite seguro de 100\.000 registros por consulta\. No se mostrarán totales parciales\.'\)/,
  "La app debe fallar explícitamente en vez de mostrar agregados parciales por encima del límite.",
);

console.log("CitaBot workspace pagination guard: OK (10 paginated tables; recent messages; fail-closed safety cap).");
