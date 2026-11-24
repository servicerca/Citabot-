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

const hasLegacyRecentMessagesQuery = /sb\.from\('messages'\)\.select\('\*'\)\.eq\('business_id',bid\)\.order\('created_at',\{ascending:false\}\)\.order\('id',\{ascending:false\}\)\.limit\(200\)/.test(html);
const hasCursorPaginatedConversationQuery =
  /messages!messages_customer_id_fkey!inner/.test(html) &&
  /function cbMessageCursorFilter\(cursor\)/.test(html) &&
  /\.eq\('business_id',businessId\)/.test(html) &&
  /\.eq\('customer_id',customerId\)/.test(html);
assert.ok(
  hasLegacyRecentMessagesQuery || hasCursorPaginatedConversationQuery,
  "Mensajes debe usar la consulta reciente heredada o el nuevo historial paginado por cursor y aislado por negocio/cliente.",
);
if (hasCursorPaginatedConversationQuery) {
  assert.doesNotMatch(html, /\.limit\(200\)/,
    "La nueva implementación no debe limitar globalmente los mensajes del negocio.");
  assert.match(html, /\.limit\(1,\{referencedTable:'messages'\}\)/,
    "La lista de conversaciones debe limitar a un mensaje reciente por cliente.");
  assert.match(html, /messages:\(m\.data\|\|\[\]\)\.flatMap\(/,
    "Las vistas previas deben prepararse desde los últimos mensajes embebidos por cliente.");
}
assert.ok(
  /messages:\(m\.data\|\|\[\]\)\.slice\(\)\.reverse\(\)/.test(html) ||
  /messages:\(m\.data\|\|\[\]\)\.flatMap\([\s\S]*?\.sort\(/.test(html),
  "Los mensajes deben presentarse en orden cronológico.",
);
assert.match(
  html,
  /if\(\(overflow\|\|\[\]\)\.length\)throw new Error\('Este negocio supera el límite seguro de 100\.000 registros por consulta\. No se mostrarán totales parciales\.'\)/,
  "La app debe fallar explícitamente en vez de mostrar agregados parciales por encima del límite.",
);

console.log("CitaBot workspace pagination guard: OK (10 paginated tables; recent messages; fail-closed safety cap).");
