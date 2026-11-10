import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const startMarker = "window.logout=async()=>{";
const endMarker = "\n  function cbTrialActive()";
const start = html.indexOf(startMarker);
const end = html.indexOf(endMarker, start);

assert.notEqual(start, -1, "Debe existir el manejador real window.logout");
assert.notEqual(end, -1, "No se pudo delimitar el manejador window.logout");

const logoutAssignment = html.slice(start, end).trim();
assert.ok(logoutAssignment.endsWith(";"), "El manejador debe terminar como una asignación completa");

async function runScenario(signOut) {
  const elements = {
    navPlatformAdmin: { style: { display: "block" } },
    app: { style: { display: "grid" } },
    landing: {
      classList: {
        added: [],
        add(value) { this.added.push(value); }
      }
    }
  };
  const toasts = [];
  const errors = [];
  const context = {
    window: {},
    elements,
    sb: { auth: { signOut } },
    console: { error(...args) { errors.push(args); } },
    showToast(message) { toasts.push(message); },
    $: id => elements[id] || null,
    document: { getElementById(id) { return elements[id] || null; } }
  };

  const harness = [
    'let currentBusiness = "business-1";',
    "let isPlatformAdmin = true;",
    'let currentData = { services: [], staff: [], customers: [{id:"keep"}], appointments: [], messages: [], campaigns: [], payments: [], subscription: null, promotions: [], boostOrders: [], platformRevenue: [] };',
    logoutAssignment,
    '({ logout: window.logout, snapshot: () => ({ currentBusiness, isPlatformAdmin, customerCount: currentData.customers.length, appDisplay: elements.app.style.display, landingClasses: elements.landing.classList.added.join(","), adminNavigationDisplay: elements.navPlatformAdmin.style.display }) })'
  ].join("\n");

  const api = vm.runInNewContext(harness, context);
  const result = await api.logout();
  return { result, snapshot: api.snapshot(), toasts, errors };
}

const success = await runScenario(async () => ({ error: null }));
assert.equal(success.result, true, "Un cierre exitoso debe devolver true");
assert.equal(success.snapshot.currentBusiness, null);
assert.equal(success.snapshot.isPlatformAdmin, false);
assert.equal(success.snapshot.customerCount, 0);
assert.equal(success.snapshot.appDisplay, "none");
assert.equal(success.snapshot.landingClasses, "active");

const returnedError = await runScenario(async () => ({ error: new Error("refresh token could not be revoked") }));
assert.equal(returnedError.result, false, "Un error devuelto por Supabase debe impedir el cierre visual");
assert.equal(returnedError.snapshot.currentBusiness, "business-1");
assert.equal(returnedError.snapshot.isPlatformAdmin, true);
assert.equal(returnedError.snapshot.customerCount, 1);
assert.equal(returnedError.snapshot.appDisplay, "grid");
assert.equal(returnedError.snapshot.landingClasses, "");
assert.match(returnedError.toasts[0] || "", /sigue activa/i);

const thrownError = await runScenario(async () => { throw new Error("network unavailable"); });
assert.equal(thrownError.result, false, "Una excepción de red debe impedir el cierre visual");
assert.equal(thrownError.snapshot.currentBusiness, "business-1");
assert.equal(thrownError.snapshot.appDisplay, "grid");
assert.equal(thrownError.snapshot.landingClasses, "");
assert.match(thrownError.toasts[0] || "", /sigue activa/i);

console.log("CitaBot logout flow: success + returned error + thrown error passed.");
