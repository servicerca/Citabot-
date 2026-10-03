import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function metaError(payload: any) {
  const e = payload?.error;
  return {
    code: e?.code ?? null,
    type: e?.type ?? null,
    subcode: e?.error_subcode ?? null,
    message: typeof e?.message === "string" ? e.message : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "No autorizado" }, 401);

    const { data: authData, error: authError } = await sb.auth.getUser(auth.slice(7));
    if (authError || !authData?.user) return json({ ok: false, error: "Sesión inválida" }, 401);

    const input = await req.json().catch(() => ({}));
    const businessId = String(input.business_id || "").trim();
    if (!businessId) return json({ ok: false, error: "business_id es obligatorio" });

    const { data: member, error: memberError } = await sb
      .from("business_members")
      .select("role")
      .eq("user_id", authData.user.id)
      .eq("business_id", businessId)
      .maybeSingle();

    if (memberError) {
      console.error("citabot-meta-sync member lookup failed", memberError);
      return json({ ok: false, error: "No se pudo validar el acceso al negocio." });
    }
    if (!member || !["owner", "admin"].includes(member.role)) {
      return json({ ok: false, error: "Sin permisos para sincronizar WhatsApp." });
    }

    if (!token) {
      return json({ ok: false, stage: "config", error: "Falta WHATSAPP_ACCESS_TOKEN en Supabase." });
    }

    const { data: integration, error: integrationError } = await sb
      .from("business_integrations")
      .select("whatsapp_business_account_id,whatsapp_phone_number_id")
      .eq("business_id", businessId)
      .eq("provider", "whatsapp")
      .eq("enabled", true)
      .maybeSingle();

    if (integrationError) {
      console.error("citabot-meta-sync integration lookup failed", integrationError);
      return json({ ok: false, error: "No se pudo consultar la configuración de WhatsApp." });
    }

    const waba = String(integration?.whatsapp_business_account_id || "").trim();
    const phone = String(integration?.whatsapp_phone_number_id || "").trim();
    if (!waba || !phone) {
      return json({ ok: false, stage: "config", error: "Falta el WhatsApp Business Account o el Phone Number ID." });
    }

    const subscriptionUrl = `https://graph.facebook.com/v26.0/${waba}/subscribed_apps`;
    const subResponse = await fetch(subscriptionUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const subPayload = await subResponse.json().catch(() => ({}));

    if (!subResponse.ok) {
      const e = metaError(subPayload);
      console.error("citabot-meta-sync subscription check failed", {
        status: subResponse.status,
        code: e.code,
        type: e.type,
        subcode: e.subcode,
        message: e.message,
      });
      return json({
        ok: false,
        stage: "subscription",
        meta_status: subResponse.status,
        meta_code: e.code,
        meta_type: e.type,
        error: e.message || `Meta rechazó la comprobación de suscripción (HTTP ${subResponse.status}).`,
      });
    }

    const subscribed = Array.isArray(subPayload.data) && subPayload.data.length > 0;
    if (!subscribed) {
      const subscribeResponse = await fetch(subscriptionUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const subscribePayload = await subscribeResponse.json().catch(() => ({}));

      if (!subscribeResponse.ok) {
        const e = metaError(subscribePayload);
        console.error("citabot-meta-sync subscription create failed", {
          status: subscribeResponse.status,
          code: e.code,
          type: e.type,
          subcode: e.subcode,
          message: e.message,
        });
        return json({
          ok: false,
          stage: "subscription_create",
          meta_status: subscribeResponse.status,
          meta_code: e.code,
          meta_type: e.type,
          error: e.message || `Meta rechazó la suscripción (HTTP ${subscribeResponse.status}).`,
        });
      }
    }

    return json({ ok: true, subscribed: true, waba_id: waba, business_id: businessId });
  } catch (error) {
    console.error("citabot-meta-sync unexpected error", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Error interno de sincronización",
    });
  }
});