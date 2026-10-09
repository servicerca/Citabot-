import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("supabase/functions/citabot-public-booking/index.ts", "utf8");

assert.match(source, /CLIENT_BOOKING_ERRORS/);
assert.match(source, /No se pudo cargar la información de reservas\. Inténtalo de nuevo más tarde\./);
assert.match(source, /No se pudo completar la reserva\. Inténtalo de nuevo más tarde\./);
assert.match(source, /PUBLIC_BOOKING_LOOKUP_FAILED/);
assert.match(source, /PUBLIC_BOOKING_CREATE_FAILED/);
assert.match(source, /El cuerpo de la solicitud no es JSON válido\./);
assert.doesNotMatch(source, /json\(\{\s*ok:\s*false,\s*error:\s*error\.message/);
assert.doesNotMatch(source, /error:\s*error instanceof Error\s*\?\s*error\.message/);
assert.doesNotMatch(source, /console\.(?:error|warn)\([^\n]*error\.message/);

console.log("Public booking error-sanitization guard: OK");
