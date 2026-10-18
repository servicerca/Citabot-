import { isWhatsAppOptOut, normalizeOptOutText } from "./opt-out.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("detecta comandos de baja en español e inglés, con mayúsculas y acentos", () => {
  const positives = [
    "STOP",
    "unsubscribe",
    "BAJA",
    "Parar",
    "No quiero recibir mensajes",
    "No me escribas más, por favor",
    "No me mandes más mensajes",
    "No me contacten de nuevo",
    "Cancelar mensajes",
    "Please stop",
    "Stop messaging me",
    "Do not contact me",
  ];
  for (const message of positives) {
    assert(isWhatsAppOptOut(message), `Debía detectar una baja: ${message}`);
  }
});

Deno.test("no confunde una solicitud de cita con una baja de WhatsApp", () => {
  const negatives = [
    "Quiero cancelar mi cita de mañana",
    "¿Me puedes bajar el precio?",
    "Quiero reservar para las 5",
    "Necesito parar el cobro de mi reserva, no los mensajes",
  ];
  for (const message of negatives) {
    assert(!isWhatsAppOptOut(message), `No debía tratarse como baja: ${message}`);
  }
});

Deno.test("normaliza acentos y puntuación sin alterar el contenido legible", () => {
  assert(
    normalizeOptOutText("¡No me escribas MÁS!").includes("no me escribas mas"),
    "La normalización debe permitir detectar variantes acentuadas.",
  );
});
