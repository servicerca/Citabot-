import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
if (!supabaseUrl || !serviceKey) throw new Error("Configuración interna de Supabase incompleta");
const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors }); }
function metaError(payload: any) {
  const e = payload?.error;
  return { code: e?.code ?? null, type: e?.type ?? null, subcode: e?.error_subcode ?? null, fbtrace_id: typeof e?.fbtrace_id === "string" ? e.fbtrace_id : null, message: typeof e?.message === "string" ? e.message : null };
}
function recommendation(code: number | null, message: string | null) {
  if (code === 200 && message?.toLowerCase().includes("api access blocked")) return "Meta está bloqueando el acceso de la app, la cuenta empresarial o la credencial. Revisar estado de la app, WhatsApp Business, permisos/verificación y Account Quality. No regenerar tokens repetidamente.";
  if (code === 190) return "La credencial fue rechazada o expiró. Validar el estado del token y volver a autorizar solo después de confirmar el acceso de la app y del negocio.";
  return "Revisar el estado y permisos de la integración de WhatsApp en Meta.";
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "No autorizado" }, 401);
    const { data: authData, error: authError } = await sb.auth.getUser(auth.slice(7));
    const user = authData?.user;
    if (authError || !user) return json({ ok: false, error: "Sesión inválida" }, 401);
    const input = await req.json().catch(() => ({}));
    const customerId = String(input.customer_id || "").trim();
    const messageBody = String(input.body || "").trim();
    if (!customerId || !messageBody) return json({ ok: false, error: "customer_id y body son obligatorios" }, 400);
    if (messageBody.length > 4096) return json({ ok: false, error: "El mensaje es demasiado largo" }, 400);
    const { data: customer, error: customerError } = await sb.from("customers").select("id,phone,business_id").eq("id", customerId).maybeSingle();
    if (customerError) return json({ ok: false, error: "No se pudo consultar el cliente." }, 500);
    if (!customer) return json({ ok: false, error: "Cliente no encontrado" }, 404);
    const { data: member, error: memberError } = await sb.from("business_members").select("business_id,role").eq("user_id", user.id).eq("business_id", customer.business_id).maybeSingle();
    if (memberError) return json({ ok: false, error: "No se pudo validar el acceso al negocio." }, 500);
    if (!member) return json({ ok: false, error: "No tienes acceso a este negocio" }, 403); const { data: subscription, error: subscriptionError } = await sb.from("subscriptions").select("plan,status,trial_ends_at").eq("business_id", customer.business_id).maybeSingle(); if (subscriptionError) return json({ ok: false, error: "No se pudo validar el plan de CitaBot." }, 500); const paidPlan = ((subscription?.status === "active" && ["professional","premium"].includes(String(subscription?.plan || "").toLowerCase())) || (subscription?.status === "trialing" && subscription?.plan === "trial" && subscription?.trial_ends_at && new Date(subscription.trial_ends_at)>new Date())); if (!paidPlan) return json({ ok: false, error: "El envío automatizado por WhatsApp está incluido desde el plan Profesional. Activa Profesional o Premium para usarlo." }, 403);
    const phone = String(customer.phone || "").replace(/\D/g, "");
    if (!phone) return json({ ok: false, error: "Cliente sin WhatsApp" }, 400);
    const { data: integration, error: integrationError } = await sb.from("business_integrations").select("whatsapp_phone_number_id,whatsapp_business_account_id,enabled").eq("business_id", customer.business_id).eq("provider", "whatsapp").maybeSingle();
    if (integrationError) return json({ ok: false, error: "No se pudo consultar la conexión de WhatsApp." }, 500);
    if (!integration?.enabled) return json({ ok: false, error: "WhatsApp no está activado para este negocio." }, 400);
    const phoneNumberId = String(integration.whatsapp_phone_number_id || "").trim();
    if (!phoneNumberId) return json({ ok: false, error: "Falta el Phone Number ID de WhatsApp." }, 400);
    if (!token) return json({ ok: false, error: "WhatsApp no está configurado en el servidor." }, 503);
    const phoneCheck = await fetch(`https://graph.facebook.com/v26.0/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating`, { headers: { Authorization: `Bearer ${token}` } });
    const phonePayload = await phoneCheck.json().catch(() => ({}));
    if (!phoneCheck.ok) {
      const e = metaError(phonePayload);
      console.error("citabot-whatsapp-send phone validation failed", { status: phoneCheck.status, phoneNumberId, ...e });
      return json({ ok: false, stage: "phone_validation", error: e.message ? `WhatsApp rechazó la validación del número: ${e.message}` : `No se pudo validar el número de WhatsApp (HTTP ${phoneCheck.status}).`, meta_status: phoneCheck.status, meta_code: e.code, meta_type: e.type, meta_subcode: e.subcode, fbtrace_id: e.fbtrace_id, recommendation: recommendation(e.code, e.message) });
    }
    const { data: messageRow, error: queueError } = await sb.from("messages").insert({
      business_id: customer.business_id,
      customer_id: customer.id,
      channel: "whatsapp",
      direction: "outbound",
      body: messageBody,
      status: "queued"
    }).select("id").single();
    if (queueError || !messageRow?.id) {
      console.error("citabot-whatsapp-send queue insert failed", queueError);
      return json({ ok: false, error: "No pudimos registrar el mensaje antes de enviarlo. Inténtalo de nuevo." }, 500);
    }
    const metaResponse = await fetch(`https://graph.facebook.com/v26.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: phone, type: "text", text: { preview_url: false, body: messageBody } }),
    });
    const metaPayload = await metaResponse.json().catch(() => ({}));
    if (!metaResponse.ok) {
      const e = metaError(metaPayload);
      await sb.from("messages").update({ status: "failed" }).eq("id", messageRow.id);
      console.error("citabot-whatsapp-send Meta send failed", { status: metaResponse.status, phoneLast4: phone.slice(-4), phoneNumberId, ...e });
      return json({ ok: false, stage: "meta", error: e.message ? `WhatsApp rechazó el envío: ${e.message}` : `WhatsApp rechazó el envío (HTTP ${metaResponse.status}).`, meta_status: metaResponse.status, meta_code: e.code, meta_type: e.type, meta_subcode: e.subcode, fbtrace_id: e.fbtrace_id, recommendation: recommendation(e.code, e.message) });
    }
    const providerMessageId = metaPayload?.messages?.[0]?.id || null;
    const { error: updateError } = await sb.from("messages").update({
      provider_message_id: providerMessageId,
      status: "sent"
    }).eq("id", messageRow.id);
    if (updateError) {
      console.error("citabot-whatsapp-send history update failed", { messageId: messageRow.id, providerMessageId, updateError });
      return json({ ok: true, saved: false, provider_message_id: providerMessageId, warning: "WhatsApp aceptó el mensaje, pero CitaBot no pudo actualizar el historial." });
    }
    return json({ ok: true, saved: true, provider_message_id: providerMessageId });
  } catch (error) {
    console.error("citabot-whatsapp-send unexpected error", error);
    return json({ ok: false, error: error instanceof Error ? error.message : "Error interno al enviar por WhatsApp" }, 500);
  }
});