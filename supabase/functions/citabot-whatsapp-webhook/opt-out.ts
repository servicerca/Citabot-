export function normalizeOptOutText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function isWhatsAppOptOut(value: string): boolean {
  const text = normalizeOptOutText(value);
  if (/^(stop|baja|parar|unsubscribe|unsubscribe me|remove me|remove me from your list|desuscribir|opt out|cancelar mensajes|no mas mensajes|no quiero mensajes|no quiero recibir mensajes|no quiero recibir whatsapp|no me escribas|no me escriban|no me contactes|no me contacten|no me hables|no mas whatsapp|stop messaging me|stop texting me|please stop|do not contact me|do not message me|do not text me|do not send me messages|dont message me|dont text me)$/.test(text)) {
    return true;
  }
  return /(^|\s)(no me escribas|no me escriban|no me contactes|no me contacten|no me vuelvas a escribir|no me hables|no quiero recibir mensajes|no quiero recibir mas mensajes|no quiero recibir whatsapp|no quiero mensajes promocionales|no deseo recibir mensajes|no deseo mensajes|no quiero mas mensajes|no mas mensajes|deja de enviarme|dejen de enviarme|no me mandes mas mensajes|no me manden mas mensajes|no me envies mas mensajes|no me envien mas mensajes|no me escribas mas|retira mi numero|retiren mi numero|sacame de la lista|sacame de sus listas|elimina mi numero|cancelar mensajes|dar de baja mensajes|desuscribir|stop messaging|stop texting me|do not contact me|do not message me|do not text me|do not send me messages|do not send me any more messages|dont message me|dont text me|remove me from your list)(\s|$)/.test(text);
}
export type WhatsAppOptOutCustomer = {
  id: string;
  whatsapp_opted_out_at: string | null;
};

export interface WhatsAppOptOutStore {
  getCustomer(businessId: string, customerId: string): Promise<WhatsAppOptOutCustomer | null>;
  setOptOut(businessId: string, customerId: string, optedOutAt: string): Promise<boolean>;
}

/**
 * Idempotently persists a customer's opt-out. Webhook retries must repair a
 * failed first write instead of treating the already-inserted inbound message
 * as proof that compliance state was saved.
 */
export async function ensureWhatsAppOptOutRecorded(
  businessId: string,
  customerId: string,
  store: WhatsAppOptOutStore,
  nowIso = new Date().toISOString(),
): Promise<void> {
  const current = await store.getCustomer(businessId, customerId);
  if (!current?.id) throw new Error("OPTOUT_CUSTOMER_NOT_FOUND");
  if (current.whatsapp_opted_out_at) return;

  if (await store.setOptOut(businessId, customerId, nowIso)) return;

  // Another concurrent webhook may have saved the opt-out after our read.
  const latest = await store.getCustomer(businessId, customerId);
  if (latest?.whatsapp_opted_out_at) return;
  throw new Error("CUSTOMER_OPTOUT_PERSIST_FAILED");
}
