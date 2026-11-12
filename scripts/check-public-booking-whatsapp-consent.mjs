import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, edge, migration] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/functions/citabot-public-booking/index.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/20261112170000_citabot_optional_booking_whatsapp_consent.sql", import.meta.url), "utf8"),
]);

assert.match(html, /if\(!privacyConsent\)\{/);
assert.doesNotMatch(html, /if\(!privacyConsent\|\|!whatsappConsent\)\{/);
assert.match(html, /Puedo reservar aunque no marque esta casilla/);
assert.match(html, /whatsapp_consent:whatsappConsent/);
assert.match(edge, /if \(!privacyConsent\) \{/);
assert.doesNotMatch(edge, /if \(!privacyConsent \|\| !whatsappConsent\)/);
assert.match(migration, /if not p_privacy_consent then raise exception/);
assert.doesNotMatch(migration, /if not p_whatsapp_consent then raise exception/);
assert.match(migration, /case when p_whatsapp_consent then now\(\) else null end/);
assert.match(migration, /if p_whatsapp_consent then/);
console.log("Public booking privacy remains required and WhatsApp consent is optional: OK");
