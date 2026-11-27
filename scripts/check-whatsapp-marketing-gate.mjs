import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const edge = await readFile(new URL("../supabase/functions/citabot-whatsapp-send/index.ts", import.meta.url), "utf8");
const purpose = await readFile(new URL("../supabase/functions/citabot-whatsapp-send/send-purpose.ts", import.meta.url), "utf8");
const booking = await readFile(new URL("../supabase/functions/citabot-public-booking/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261126120000_citabot_marketing_consent_read_scope.sql", import.meta.url), "utf8");

assert.match(html, /id="pbMarketing"/, "La reserva pública debe ofrecer consentimiento de marketing separado.");
const marketingCheckbox = html.slice(html.indexOf('id="pbMarketing"') - 150, html.indexOf('id="pbMarketing"') + 700);
assert.doesNotMatch(marketingCheckbox, /\bchecked\b|\brequired\b/, "El permiso promocional debe ser opcional y desmarcado por defecto.");
assert.match(marketingCheckbox, /No es requisito para reservar/i);
assert.match(marketingCheckbox, /BAJA/i);
assert.match(html, /marketing_consent:marketingConsent/);
assert.match(booking, /input\.marketing_consent === true/);
assert.match(booking, /context: "public_booking_marketing"/);
assert.match(booking, /metadata: \{[\s\S]*purpose: "marketing"/);
assert.match(booking, /document: "whatsapp"/);
assert.match(booking, /MARKETING_CONSENT_VERSION/);
assert.match(migration, /legal_acceptances_business_marketing_select/);
assert.match(migration, /context = 'public_booking_marketing'/);
assert.match(migration, /metadata ->> 'purpose' = 'marketing'/);
assert.match(migration, /business_members/);

const recoveryStart = html.indexOf("window.prepareRecoveryCampaign=()=>");
const recoveryEnd = html.indexOf("window.filterClients=()=>", recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart, "Debe existir la preparación real del borrador.");
const recoveryHandler = html.slice(recoveryStart, recoveryEnd);
assert.match(recoveryHandler, /openModal\('Nueva campaña'\)/);
assert.match(recoveryHandler, /inactive_30/);
assert.match(recoveryHandler, /No se enviará desde CitaBot/i);
assert.doesNotMatch(recoveryHandler, /functions\.invoke\(['"]citabot-whatsapp-send['"]/,
  "Preparar recuperación no debe enviar mensajes.");

assert.match(html, /recoveryConsentNotice/);
assert.match(html, /Baja registrada/);
assert.match(html, /Consentimiento registrado/);
assert.match(html, /cbIsRecoveryEligible/);
assert.match(purpose, /WHATSAPP_MARKETING_CONSENT_REQUIRED/);
assert.match(purpose, /Los envíos promocionales están pausados/);
const validationAt = edge.indexOf("validateWhatsAppSendPurpose(input.purpose)");
const customerLookupAt = edge.indexOf('sb.from("customers")');
const metaSendAt = edge.indexOf("https://graph.facebook.com");
assert.ok(validationAt >= 0 && customerLookupAt > validationAt && metaSendAt > validationAt,
  "El propósito debe validarse antes de consultar destinatarios o llamar a Meta.");
assert.match(edge, /validateWhatsAppServiceReplyReference\(input\.reply_to_message_id\)/);
assert.match(edge, /matchesLatestInboundReply\(replyToMessageId, lastInbound\?\.id\)/);
assert.match(edge, /matchesLatestInboundReply\(replyToMessageId, freshInbound\?\.id\)/);
assert.match(html, /purpose:'service'/, "El chat manual debe indicar explícitamente el propósito service.");
assert.match(html, /reply_to_message_id:replyTo\.id/, "El chat debe pasar la referencia al mensaje entrante.");

console.log("CitaBot marketing consent capture, recovery preparation and fail-closed WhatsApp gate: OK");
