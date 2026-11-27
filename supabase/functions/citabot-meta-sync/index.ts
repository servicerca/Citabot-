import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readApprovedMarketingTemplates } from "./template-readiness.ts";

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
      .select("id,business_id,whatsapp_business_account_id,whatsapp_phone_number_id,enabled")
      .eq("business_id", businessId)
      .eq("provider", "whatsapp")
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

    let subscribed = Array.isArray(subPayload.data) && subPayload.data.length > 0;
    if (!subscribed) {
      const subscribeResponse = await fetch(subscriptionUrl, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
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
          error: e.message || "Meta rechazó la suscripción (HTTP " + subscribeResponse.status + ").",
        });
      }

      // Confirm the subscription with Meta instead of trusting only the POST response.
      const verifySubscription = await fetch(subscriptionUrl, {
        headers: { Authorization: "Bearer " + token },
      });
      const verifyPayload = await verifySubscription.json().catch(() => ({}));
      if (!verifySubscription.ok) {
        const e = metaError(verifyPayload);
        return json({
          ok: false,
          stage: "subscription_verify",
          meta_status: verifySubscription.status,
          meta_code: e.code,
          meta_type: e.type,
          error: e.message || "No se pudo verificar la suscripción de la aplicación con Meta.",
        });
      }
      subscribed = Array.isArray(verifyPayload.data) && verifyPayload.data.length > 0;
    }

    if (!subscribed) {
      return json({
        ok: false,
        stage: "subscription_verify",
        error: "Meta no confirmó que CitaBot esté suscrito a la cuenta de WhatsApp Business.",
      });
    }

    // Confirm that the configured Phone Number ID belongs to the supplied WABA.
    const phoneListUrl = "https://graph.facebook.com/v26.0/" + encodeURIComponent(waba)
      + "/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status&limit=100";
    const phoneListResponse = await fetch(phoneListUrl, {
      headers: { Authorization: "Bearer " + token },
    });
    const phoneListPayload = await phoneListResponse.json().catch(() => ({}));
    if (!phoneListResponse.ok || !Array.isArray(phoneListPayload.data)) {
      const e = metaError(phoneListPayload);
      return json({
        ok: false,
        stage: "phone_list",
        meta_status: phoneListResponse.status,
        meta_code: e.code,
        meta_type: e.type,
        error: e.message || "No fue posible consultar los números vinculados a esta cuenta de WhatsApp Business.",
      });
    }
    const phone = phoneListPayload.data.find((item: any) => String(item?.id || "") === PHONE);
    if (!phone) {
      return json({
        ok: false,
        stage: "phone_validation",
        error: "El Phone Number ID no pertenece a la cuenta de WhatsApp Business indicada.",
      });
    }

    const { data: enabledIntegration, error: enableError } = await sb
      .from("business_integrations")
      .update({ enabled: true, updated_at: new Date().toISOString() })
      .eq("id", integration.id)
      .eq("business_id", businessId)
      .eq("provider", "whatsapp")
      .select("id")
      .maybeSingle();
    if (enableError || !enabledIntegration?.id) {
      console.error("citabot-meta-sync integration enable failed", {
        code: enableError?.code || "INTEGRATION_ENABLE_NOT_CONFIRMED",
      });
      return json({
        ok: false,
        stage: "integration_enable",
        error: "Meta respondió, pero no se pudo activar la conexión del negocio.",
      });
    }

    const templateReadiness = await readApprovedMarketingTemplates(waba, token);
    return json({
      ok: true,
      subscribed: true,
      integration_enabled: true,
      waba_id: waba,
      business_id: businessId,
      phone: {
        id: phone.id || null,
        display_phone_number: phone.display_phone_number || null,
        verified_name: phone.verified_name || null,
        quality_rating: phone.quality_rating || null,
        code_verification_status: phone.code_verification_status || null,
      },
      template_readiness: templateReadiness,
      approved_marketing_template_available: templateReadiness.checked &&
        templateReadiness.approved_marketing_templates.length > 0,
    });
  } catch (error) {
    console.error("citabot-meta-sync unexpected error", error);
    return json({
      ok: false,
      error: error instanceof Error ? error.message : "Error interno de sincronización",
    });
  }
});