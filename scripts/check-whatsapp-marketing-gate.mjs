import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const edge = await readFile(new URL("../supabase/functions/citabot-whatsapp-send/index.ts", import.meta.url), "utf8");

const recoveryStart = html.indexOf("window.sendRecoveryMessages=async()=>");
const recoveryEnd = html.indexOf("window.filterClients=()=>", recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "Debe existir la guarda de recuperación.");
const recoveryHandler = html.slice(recoveryStart, recoveryEnd);
assert.match(recoveryHandler, /consentimiento específico de marketing/i);
assert.doesNotMatch(recoveryHandler, /functions\.invoke\(['"]citabot-whatsapp-send['"]/,
  "El manejador de recuperación no puede intentar enviar mensajes.");

assert.match(html, /recoveryConsentNotice/);
assert.match(html, /envío promocional permanece pausado|envíos proactivos por WhatsApp siguen pausados|envíos promocionales por WhatsApp están pausados/i);
assert.match(html, /purpose:'service'/, "El chat manual debe indicar explícitamente el propósito service.");

assert.match(edge, /validateWhatsAppSendPurpose/);
assert.match(edge, /input\.purpose/);
assert.match(edge, /WHATSAPP_MARKETING_CONSENT_REQUIRED/);
const validationAt = edge.indexOf("validateWhatsAppSendPurpose(input.purpose)");
const customerLookupAt = edge.indexOf('sb.from("customers")');
const metaSendAt = edge.indexOf("https://graph.facebook.com");
assert.ok(validationAt >= 0 && customerLookupAt > validationAt && metaSendAt > validationAt,
  "El propósito debe validarse antes de consultar destinatarios o llamar a Meta.");
assert.match(edge, /WHATSAPP_SEND_PURPOSE_REQUIRED/);

console.log("CitaBot marketing consent fail-closed guard: OK");
