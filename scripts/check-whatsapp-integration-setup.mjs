import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const metaSync = await readFile(new URL("../supabase/functions/citabot-meta-sync/index.ts", import.meta.url), "utf8");

assert.match(html, /id="setWhatsAppWaba"/);
assert.match(html, /id="setWhatsAppPhoneId"/);
assert.match(html, /window\.saveWhatsAppIntegration=async/);
const handlerStart=html.indexOf("window.saveWhatsAppIntegration=async");
const handlerEnd=html.indexOf("window.saveSettings=async",handlerStart);
assert.ok(handlerStart>=0&&handlerEnd>handlerStart);
const handler=html.slice(handlerStart,handlerEnd);
assert.match(handler,/enabled:false/);
assert.match(handler,/functions\.invoke\('citabot-meta-sync'/);
assert.match(handler,/integration_enabled!==true/);
assert.doesNotMatch(html,/id="(?:whatsappAccessToken|setWhatsAppToken)"/i);
assert.match(metaSync,/\.select\("id,business_id,whatsapp_business_account_id,whatsapp_phone_number_id,enabled"\)/);
assert.doesNotMatch(metaSync,/\.eq\("enabled", true\)/);
assert.match(metaSync,/phone_numbers\?fields=/);
assert.match(metaSync,/El Phone Number ID no pertenece/);
assert.match(metaSync,/integration_enabled: true/);
const phoneCheckAt=metaSync.indexOf("const phoneDetails = phoneListPayload.data.find");
const enableAt=metaSync.indexOf(".update({ enabled: true",phoneCheckAt);
assert.ok(phoneCheckAt>0&&enableAt>phoneCheckAt,"Integration is enabled only after Meta confirms that the phone belongs to the WABA.");
assert.match(metaSync,/readApprovedMarketingTemplates/);
console.log("CitaBot secure WhatsApp Business connection setup: OK");
