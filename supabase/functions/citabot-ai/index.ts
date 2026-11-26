import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { validateAiRequest } from "./request-validation.ts";
import { buildResponsesRequest } from "./responses-request.ts";
import { createOpenAiResponse } from "./openai-client.ts";
import { decideAiQuota } from "./ai-usage-policy.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization") || "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!jwt) return json({ error: "No autenticado" }, 401);

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Configuración interna incompleta");

    const admin = createClient(url, key, { auth: { persistSession: false } });
    const authResult = await admin.auth.getUser(jwt);
    const user = authResult.data.user;
    if (authResult.error || !user) return json({ error: "Sesión no válida" }, 401);

    const parsedBody = await req.json().catch(() => null);
    const validated = validateAiRequest(parsedBody);
    if (!validated.ok) return json({ error: validated.error }, validated.status);

    const { businessId, input, serializedContext } = validated;
    const membership = await admin
      .from("business_members")
      .select("role")
      .eq("business_id", businessId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membership.error || !membership.data) {
      return json({ error: "Sin acceso a este negocio" }, 403);
    }

    const subscriptionResult = await admin
      .from("subscriptions")
      .select("plan,status,trial_ends_at")
      .eq("business_id", businessId)
      .maybeSingle();

    if (subscriptionResult.error) throw subscriptionResult.error;
    const subscription = subscriptionResult.data;
    const entitled = (
      subscription?.status === "active" &&
      ["professional", "premium"].includes(String(subscription?.plan || "").toLowerCase())
    ) || (
      subscription?.status === "trialing" &&
      subscription?.plan === "trial" &&
      subscription?.trial_ends_at &&
      new Date(subscription.trial_ends_at) > new Date()
    );

    if (!entitled) {
      return json({ error: "La IA de CitaBot está disponible desde el plan Profesional." }, 403);
    }

    const businessResult = await admin
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .maybeSingle();
    if (businessResult.error) throw businessResult.error;

    const businessName = businessResult.data?.name || "negocio";
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const model = Deno.env.get("OPENAI_MODEL");

    if (!apiKey || !model) {
      console.error("CITABOT_AI_CONFIGURATION_MISSING", {
        api_key_configured: Boolean(apiKey),
        model_configured: Boolean(model),
      });
      return json({ error: "IA no configurada" }, 503);
    }

    const quotaResult = await admin.rpc("reserve_citabot_ai_request", {
      p_business_id: businessId,
      p_plan: subscription?.status === "trialing" ? "trial" : String(subscription?.plan || "").toLowerCase(),
      p_input_chars: input.length,
      p_context_chars: serializedContext.length,
    });
    const quotaDecision = decideAiQuota(quotaResult.data, quotaResult.error);
    if (!quotaDecision.allowed) {
      return json({ ok: false, code: quotaDecision.code, error: quotaDecision.message }, quotaDecision.status);
    }

    const payload = buildResponsesRequest(
      model,
      String(businessName),
      serializedContext,
      input,
      quotaDecision.maxOutputTokens,
    );
    const provider = await createOpenAiResponse(apiKey, payload);

    if (!provider.ok) {
      // Log provider diagnostics only. Never log API keys, business/customer
      // messages, serialized context, phone numbers, or authentication tokens.
      console.error("CITABOT_AI_PROVIDER_FAILED", {
        status: provider.status,
        attempts: provider.attempts,
        failure_kind: provider.failureKind,
        provider_error_code: provider.errorCode,
        provider_error_type: provider.errorType,
        request_id: provider.requestId,
      });
      return json({
        ok: false,
        degraded: true,
        error: "La IA no está disponible temporalmente. La agenda, clientes y demás funciones de CitaBot siguen operativas.",
        provider_status: provider.status,
      }, 503);
    }

    const rawText = provider.data.output_text;
    const outputItems = Array.isArray(provider.data.output) ? provider.data.output : [];
    const responseText = typeof rawText === "string"
      ? rawText
      : outputItems
        .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
        .map((part: any) => typeof part?.text === "string" ? part.text : "")
        .join("");

    const usage = provider.data.usage && typeof provider.data.usage === "object"
      ? provider.data.usage as Record<string, unknown>
      : {};
    const inputTokens = Number.isSafeInteger(Number(usage.input_tokens)) && Number(usage.input_tokens) >= 0
      ? Number(usage.input_tokens)
      : 0;
    const outputTokens = Number.isSafeInteger(Number(usage.output_tokens)) && Number(usage.output_tokens) >= 0
      ? Number(usage.output_tokens)
      : 0;
    const usageWrite = await admin.rpc("record_citabot_ai_usage", {
      p_business_id: businessId,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
    });
    if (usageWrite.error) {
      console.error("CITABOT_AI_USAGE_RECORD_FAILED", {
        code: typeof usageWrite.error.code === "string" ? usageWrite.error.code : "unknown",
      });
    }

    if (!responseText.trim()) {
      console.error("CITABOT_AI_EMPTY_PROVIDER_OUTPUT", {
        status: provider.status,
        request_id: provider.requestId,
      });
      return json({
        ok: false,
        degraded: true,
        error: "La IA no generó una respuesta utilizable. Inténtalo nuevamente.",
      }, 503);
    }

    return json({
      ok: true,
      text: responseText,
      provider: "openai",
      model,
    });
  } catch (error) {
    console.error(
      "CITABOT_AI_INTERNAL_FAILURE",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json({
      error: "No se pudo procesar la solicitud de IA temporalmente.",
    }, 500);
  }
});
