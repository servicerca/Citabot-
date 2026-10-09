import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const booking = read("supabase/functions/citabot-public-booking/index.ts");
assert.match(booking, /CLIENT_BOOKING_ERRORS/);
assert.match(booking, /No se pudo cargar la información de reservas\\. Inténtalo de nuevo más tarde\\./);
assert.match(booking, /No se pudo completar la reserva\\. Inténtalo de nuevo más tarde\\./);
assert.match(booking, /PUBLIC_BOOKING_LOOKUP_FAILED/);
assert.match(booking, /PUBLIC_BOOKING_CREATE_FAILED/);
assert.match(booking, /El cuerpo de la solicitud no es JSON válido\\./);
assert.doesNotMatch(booking, /json\\(\\{\\s*ok:\\s*false,\\s*error:\\s*error\\.message/);
assert.doesNotMatch(booking, /error:\\s*error instanceof Error\\s*\\?\\s*error\\.message/);

const whatsapp = read("supabase/functions/citabot-whatsapp-webhook/index.ts");
assert.match(whatsapp, /function logBackendFailure/);
assert.match(whatsapp, /No se pudo procesar el webhook\\./);
assert.doesNotMatch(whatsapp, /JSON\\.stringify\\(\\{error:e instanceof Error\\?e\\.message/);
assert.doesNotMatch(whatsapp, /console\\.error\\("CITABOT_WEBHOOK_ERROR",e\\)/);
assert.doesNotMatch(whatsapp, /console\\.error\\("CITABOT_(?:READ_RECEIPT_FAILED|AI_FALLBACK)",e\\)/);

const mercadoPago = read("supabase/functions/citabot-mercadopago-webhook/index.ts");
assert.match(mercadoPago, /function logWebhookFailure/);
assert.match(mercadoPago, /No se pudo procesar el evento de pago/);
assert.doesNotMatch(mercadoPago, /e instanceof Error\\?e\\.message:'Error interno'/);
assert.doesNotMatch(mercadoPago, /console\\.error\\('CITABOT_MERCADOPAGO_WEBHOOK_ERROR',e\\)/);

console.log("Public Edge error-sanitization guard: OK");
