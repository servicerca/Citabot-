import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const checkout = await readFile(new URL("../supabase/functions/citabot-commercial-checkout/index.ts", import.meta.url), "utf8");

assert.match(checkout, /const DIRECTORY_BOOST_CHECKOUT_ENABLED = false/);
const boostStart = checkout.indexOf('if(mode==="boost"){');
const gateAt = checkout.indexOf("DIRECTORY_BOOST_CHECKOUT_ENABLED", boostStart);
const orderInsertAt = checkout.indexOf('db.from("directory_boost_orders").insert', boostStart);
const preferenceAt = checkout.indexOf('https://api.mercadopago.com/checkout/preferences', boostStart);
assert.ok(boostStart >= 0 && gateAt > boostStart && orderInsertAt > gateAt && preferenceAt > gateAt,
  "El cierre de servidor debe ejecutarse antes de crear pedidos o preferencias de Mercado Pago.");
const revenueStart = html.indexOf("function cbRenderRevenue()");
const revenueEnd = html.indexOf("function cbRenderSettings()", revenueStart);
const revenue = html.slice(revenueStart, revenueEnd);
assert.match(revenue, /Compra temporalmente deshabilitada/);
assert.doesNotMatch(revenue, /onclick="buyDirectoryBoost/);
const handlerStart = html.indexOf("window.buyDirectoryBoost=async");
const handlerEnd = html.indexOf("window.subscribeProfessional=", handlerStart);
const handler = html.slice(handlerStart, handlerEnd);
assert.match(handler, /No se ha creado ningún pedido ni enlace de pago/);
assert.doesNotMatch(handler, /citabot-commercial-checkout/);
console.log("CitaBot directory boost checkout remains blocked in UI and server: OK");
