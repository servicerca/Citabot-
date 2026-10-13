import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "./check-workspace-pagination.mjs";

const html = readFileSync("index.html", "utf8");
const heading = html.indexOf("<h3>Premium</h3>");
assert.ok(heading >= 0, "public pricing must include the Premium plan");

const cardStart = html.lastIndexOf('<div class="plan-card">', heading);
const listEnd = html.indexOf("</ul>", heading);
const cardEnd = html.indexOf("</div>", listEnd);
assert.ok(cardStart >= 0 && listEnd > heading && cardEnd > listEnd,
  "could not isolate the public Premium pricing card");

const card = html.slice(cardStart, cardEnd + "</div>".length);
assert.match(card, /<button\b[^>]*onclick="showOnboarding\(\)"/,
  "Premium card must have a working signup action");
assert.match(card, /Crear cuenta gratis/,
  "CTA must explain that account creation is the next step");

console.log("CitaBot public Premium pricing CTA: OK");

const pricingHtml = html;
assert.doesNotMatch(pricingHtml, /Más elegido/i,
  "do not publish social-proof claims until real usage data supports them");
assert.match(pricingHtml, /Conexión con WhatsApp Business \(requiere configuración de Meta\)/,
  "WhatsApp plan copy must disclose the external Meta setup requirement");
assert.match(pricingHtml, /Asistencia de IA y automatizaciones \(según configuración y plan\)/,
  "AI and automation copy must not imply every integration is already connected");
assert.match(pricingHtml, /Funciones avanzadas de IA \(requieren configuración activa\)/,
  "advanced AI copy must disclose configuration requirements");
assert.match(pricingHtml, /La compra de posiciones destacadas se habilitará cuando terminemos de validar los pagos/,
  "directory boost copy must not present payment as validated before end-to-end verification");
assert.match(pricingHtml, /Mercado Pago: prueba externa pendiente/,
  "payment validation status must stay visible while production checkout remains unverified");
assert.doesNotMatch(pricingHtml,
  /Los negocios pueden comprar posiciones destacadas en el directorio mediante Mercado Pago/i,
  "do not advertise direct purchases as ready while external payment validation is pending");

console.log("CitaBot public pricing readiness and evidence-based claims: OK");

const tempDir = mkdtempSync(join(tmpdir(), "citabot-inline-js-"));
try {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  let inlineCount = 0;
  for (let i = 0; i < scripts.length; i++) {
    const attrs = scripts[i][1];
    const body = scripts[i][2];
    if (/\bsrc\s*=/.test(attrs)) continue;
    const file = join(tempDir, `inline-${i + 1}.js`);
    writeFileSync(file, body, "utf8");
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    inlineCount++;
  }
  assert.ok(inlineCount >= 3, `Se esperaban al menos 3 scripts inline, encontrados: ${inlineCount}`);
  console.log(`CitaBot inline JavaScript syntax: OK (${inlineCount} scripts)`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

