import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../supabase/functions/citabot-commercial-checkout/index.ts", import.meta.url),
  "utf8",
);
const start = source.indexOf('if(remote.status==="authorized")');
const end = source.indexOf('if(remote.status==="pending"', start);
assert.notEqual(start, -1, "Debe existir la rama de preaprobación autorizada.");
assert.notEqual(end, -1, "Debe existir la rama de checkout pendiente.");
assert.ok(end > start, "La rama pendiente debe seguir a la rama autorizada.");

const authorized = source.slice(start, end);
assert.match(source, /hasCurrentPaidSubscriptionPeriod/,
  "Checkout Premium debe reutilizar la validación del periodo pagado.");
assert.match(authorized, /from\("payments"\)/,
  "Debe consultar el libro de pagos antes de restaurar Premium.");
assert.match(authorized, /eq\("provider_reference",String\(prior\.provider_subscription_id\)\)/,
  "La factura debe corresponder a la preaprobación exacta.");
assert.match(authorized, /eq\("status","paid"\)/,
  "Solo una factura pagada acredita el periodo.");
assert.match(authorized, /hasCurrentPaidSubscriptionPeriod\(/,
  "La activación debe exigir factura pagada y periodo vigente.");
assert.match(authorized, /already_pending:true/,
  "Sin factura del periodo vigente la suscripción debe seguir pendiente.");

const paidGuard = authorized.indexOf("hasCurrentPaidSubscriptionPeriod(");
const activeWrite = authorized.indexOf('status:"active"');
assert.ok(paidGuard >= 0 && activeWrite > paidGuard,
  "La escritura active debe ocurrir después de comprobar la factura y el periodo.");
assert.ok(authorized.includes('status:"pending"'),
  "La ausencia de factura del periodo debe mantener pending.");

console.log("CitaBot Premium checkout paid-invoice guard: passed.");
