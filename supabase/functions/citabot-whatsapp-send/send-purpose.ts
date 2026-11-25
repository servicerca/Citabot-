export type WhatsAppSendPurpose = "service";

export type WhatsAppSendPurposeDecision =
  | { ok: true; purpose: WhatsAppSendPurpose }
  | { ok: false; status: 400 | 403; code: string; error: string };

/**
 * Until CitaBot has a durable, revocable per-customer marketing consent source,
 * only customer-service replies inside the existing 24-hour window are allowed.
 * Missing/unknown purposes fail closed rather than silently becoming service.
 */
export function validateWhatsAppSendPurpose(value: unknown): WhatsAppSendPurposeDecision {
  if (value === "service") {
    return { ok: true, purpose: "service" };
  }

  if (value === "marketing") {
    return {
      ok: false,
      status: 403,
      code: "WHATSAPP_MARKETING_CONSENT_REQUIRED",
      error: "Los envíos promocionales están pausados hasta que CitaBot pueda verificar el consentimiento específico de marketing y su revocación. No se ha enviado nada.",
    };
  }

  return {
    ok: false,
    status: 400,
    code: "WHATSAPP_SEND_PURPOSE_REQUIRED",
    error: "Indica un propósito de envío válido. Solo están habilitadas las respuestas de servicio; no se ha enviado nada.",
  };
}

export type WhatsAppServiceReplyReferenceDecision =
  | { ok: true; id: string }
  | { ok: false; status: 400; code: "WHATSAPP_SERVICE_REPLY_REQUIRED"; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateWhatsAppServiceReplyReference(value: unknown): WhatsAppServiceReplyReferenceDecision {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    return {
      ok: false,
      status: 400,
      code: "WHATSAPP_SERVICE_REPLY_REQUIRED",
      error: "Selecciona una respuesta a un mensaje entrante válido del cliente. No se ha enviado nada.",
    };
  }
  return { ok: true, id: value.trim() };
}

export function matchesLatestInboundReply(replyToMessageId: string, latestInboundMessageId: unknown): boolean {
  return typeof latestInboundMessageId === "string" && latestInboundMessageId === replyToMessageId;
}
