import { CUSTOMER_SERVICE_WINDOW_MS, isInsideWhatsAppCustomerServiceWindow } from "./customer-service-window.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("permite texto libre con una ventana de servicio aún abierta", () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  const recent = new Date(now - CUSTOMER_SERVICE_WINDOW_MS + 1).toISOString();
  assert(isInsideWhatsAppCustomerServiceWindow(recent, now), "La ventana debe seguir abierta un milisegundo antes del límite.");
});

Deno.test("cierra la ventana a las 24 horas exactas", () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  const exactlyExpired = new Date(now - CUSTOMER_SERVICE_WINDOW_MS).toISOString();
  assert(!isInsideWhatsAppCustomerServiceWindow(exactlyExpired, now), "La ventana debe estar cerrada a las 24 horas exactas.");
});

Deno.test("rechaza fecha ausente, inválida o futura", () => {
  const now = Date.UTC(2026, 9, 18, 12, 0, 0);
  assert(!isInsideWhatsAppCustomerServiceWindow(null, now), "No hay ventana sin un mensaje entrante.");
  assert(!isInsideWhatsAppCustomerServiceWindow("not-a-date", now), "No debe aceptar una fecha inválida.");
  assert(!isInsideWhatsAppCustomerServiceWindow(new Date(now + 1000).toISOString(), now), "No debe aceptar marcas de tiempo futuras.");
});
