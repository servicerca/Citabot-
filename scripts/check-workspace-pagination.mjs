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

assert.doesNotMatch(
  html,
  /sb\.from\(['"]messages['"]\).*\.limit\(200\)/s,
  "El historial no debe recortarse con un límite global de 200 mensajes.",
);
assert.match(
  html,
  /messages!messages_customer_id_fkey!inner/,
  "La lista debe consultar mensajes recientes a través de cada cliente.",
);
assert.match(
  html,
  /\.eq\(['"]messages\.business_id['"],bid\)/,
  "La vista previa de mensajes debe aislarse por negocio.",
);
assert.match(
  html,
  /\.limit\(1,\{referencedTable:'messages'\}\)/,
  "La vista previa debe cargar como máximo el mensaje más reciente por cliente.",
);
assert.match(
  html,
  /messages:\(m\.data\|\|\[\]\)\.flatMap\(customer=>\(customer\.messages\|\|\[\]\)\.map/,
  "Las vistas previas deben transformarse en mensajes con el identificador del cliente.",
);
assert.match(
  html,
  /if\(\(overflow\|\|\[\]\)\.length\)throw new Error\('Este negocio supera el límite seguro de 100\.000 registros por consulta\. No se mostrarán totales parciales\.'\)/,
  "La app debe fallar explícitamente en vez de mostrar agregados parciales por encima del límite.",
);

console.log("CitaBot workspace pagination guard: OK (10 paginated tables; recent messages; fail-closed safety cap).");
