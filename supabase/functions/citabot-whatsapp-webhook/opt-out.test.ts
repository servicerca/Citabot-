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
    "No me contactes",
    "Por favor, no me contactes otra vez",
    "No me hables más",
    "No quiero mensajes promocionales",
    "Sácame de la lista",
    "Cancelar mensajes",
    "Please stop",
    "Stop messaging me",
    "Stop texting me",
    "Unsubscribe me",
    "Remove me from your list",
    "Do not contact me",
    "Do not text me",
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

import {
  ensureWhatsAppOptOutRecorded,
  type WhatsAppOptOutCustomer,
  type WhatsAppOptOutStore,
} from "./opt-out.ts";

Deno.test("persiste la baja de forma idempotente sin sobrescribir la primera fecha", async () => {
  let customer: WhatsAppOptOutCustomer | null = { id: "customer-1", whatsapp_opted_out_at: null };
  let writes = 0;
  const store: WhatsAppOptOutStore = {
    getCustomer: async () => customer,
    setOptOut: async (_businessId, _customerId, timestamp) => {
      writes += 1;
      if (!customer || customer.whatsapp_opted_out_at) return false;
      customer = { ...customer, whatsapp_opted_out_at: timestamp };
      return true;
    },
  };

  await ensureWhatsAppOptOutRecorded("business-1", "customer-1", store, "2026-10-18T10:00:00.000Z");
  await ensureWhatsAppOptOutRecorded("business-1", "customer-1", store, "2026-10-18T10:05:00.000Z");

  assert(writes === 1, "Una baja ya guardada no debe volver a sobrescribirse.");
  assert(customer?.whatsapp_opted_out_at === "2026-10-18T10:00:00.000Z", "Debe conservarse la primera fecha de baja.");
});

Deno.test("un reintento repara una escritura de baja que falló temporalmente", async () => {
  let customer: WhatsAppOptOutCustomer | null = { id: "customer-2", whatsapp_opted_out_at: null };
  let attempts = 0;
  const store: WhatsAppOptOutStore = {
    getCustomer: async () => customer,
    setOptOut: async (_businessId, _customerId, timestamp) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary database failure");
      if (!customer || customer.whatsapp_opted_out_at) return false;
      customer = { ...customer, whatsapp_opted_out_at: timestamp };
      return true;
    },
  };

  let failed = false;
  try {
    await ensureWhatsAppOptOutRecorded("business-1", "customer-2", store, "2026-10-18T11:00:00.000Z");
  } catch {
    failed = true;
  }
  assert(failed, "La primera escritura simulada debe fallar.");
  await ensureWhatsAppOptOutRecorded("business-1", "customer-2", store, "2026-10-18T11:01:00.000Z");
  assert(customer?.whatsapp_opted_out_at === "2026-10-18T11:01:00.000Z", "El reintento debe guardar la baja.");
});

Deno.test("acepta la escritura de otra ejecución concurrente al volver a leer el cliente", async () => {
  let customer: WhatsAppOptOutCustomer | null = { id: "customer-3", whatsapp_opted_out_at: null };
  const store: WhatsAppOptOutStore = {
    getCustomer: async () => customer,
    setOptOut: async (_businessId, _customerId, timestamp) => {
      customer = { ...customer!, whatsapp_opted_out_at: timestamp };
      return false;
    },
  };

  await ensureWhatsAppOptOutRecorded("business-1", "customer-3", store, "2026-10-18T12:00:00.000Z");
  assert(Boolean(customer?.whatsapp_opted_out_at), "La operación concurrente ya dejó la baja guardada.");
});

