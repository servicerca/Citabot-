import {
  CUSTOMER_SERVICE_WINDOW_MS,
  isInsideWhatsAppCustomerServiceWindow,
  parseWhatsAppProviderTimestamp,
} from "./whatsapp-compliance.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("parsea el timestamp Unix en segundos remitido por Meta", () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  const sentAt = now - 60_000;
  const parsed = parseWhatsAppProviderTimestamp(String(Math.floor(sentAt / 1000)), now);
  assert(parsed === new Date(sentAt).toISOString(), "El timestamp del proveedor debe conservar la hora real del mensaje.");
  assert(isInsideWhatsAppCustomerServiceWindow(parsed, now), "Una entrada reciente debe abrir la ventana de atención.");
});

Deno.test("rechaza timestamp de proveedor ausente, mal formado o futuro", () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  for (const value of [null, undefined, "", "not-a-timestamp", "123", 0, -1, Math.floor(now / 1000) + 60]) {
    assert(parseWhatsAppProviderTimestamp(value, now) === null, "No debía aceptar un timestamp inválido.");
  }
});

Deno.test("un mensaje antiguo no abre la ventana aunque el webhook se procese ahora", () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  const oldAt = now - CUSTOMER_SERVICE_WINDOW_MS - 60_000;
  const providerTimestamp = parseWhatsAppProviderTimestamp(String(Math.floor(oldAt / 1000)), now);
  assert(providerTimestamp !== null, "Debe conservarse un timestamp antiguo válido para el historial.");
  assert(!isInsideWhatsAppCustomerServiceWindow(providerTimestamp, now), "La ventana debe estar cerrada cuando el mensaje real es antiguo.");
});
