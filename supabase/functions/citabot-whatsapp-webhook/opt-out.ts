export function normalizeOptOutText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function isWhatsAppOptOut(value: string): boolean {
  const text = normalizeOptOutText(value);
  if (/^(stop|baja|parar|unsubscribe|desuscribir|opt out|cancelar mensajes|no mas mensajes|no quiero mensajes|no quiero recibir mensajes|no me escribas|no me escriban|no me contacten|no mas whatsapp|stop messaging me|please stop|do not contact me|do not message me|dont message me)$/.test(text)) {
    return true;
  }
  return /(^|\s)(no me escribas|no me escriban|no me contacten|no quiero recibir mensajes|no quiero mas mensajes|no mas mensajes|deja de enviarme|dejen de enviarme|no me mandes mas mensajes|no me manden mas mensajes|cancelar mensajes|dar de baja mensajes|desuscribir|stop messaging|do not contact me|do not message me|dont message me)(\s|$)/.test(text);
}
