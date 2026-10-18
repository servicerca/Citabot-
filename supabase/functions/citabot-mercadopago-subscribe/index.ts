import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
const PUBLIC_URL = Deno.env.get("CITABOT_PUBLIC_URL") || "https://servicerca.github.io/Citabot-/";
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Supabase server configuration missing");
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type SubscriptionSnapshot = {
  id: string;
  business_id: string;
  plan: string;
  status: string;
  trial_started_at?: string | null;
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  provider?: string | null;
  provider_customer_id?: string | null;
  provider_subscription_id?: string | null;
};

type ReconciliationState = "in_progress" | "resolved" | "reconciliation_required";
type ReconciliationPhase =
  | "initiating"
  | "provider_created"
  | "local_pending_saved"
  | "old_subscription_cancelled"
  | "rollback_started"
  | "rolled_back"
  | "local_restore_failed"
  | "rollback_unconfirmed"
  | "finished";

function logCheckoutFailure(event: string, error: unknown) {
  const candidate = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : null;
  const code = typeof candidate === "string" && /^[A-Z0-9_]{1,20}$/.test(candidate) ? candidate : "unknown";
  console.error(event, JSON.stringify({ code }));
}

function throwOnDbError(operation: string, error: { code?: unknown } | null | undefined) {
  if (!error) return;
  const candidate = error.code;
  const code = typeof candidate === "string" && /^[A-Z0-9_]{1,20}$/.test(candidate) ? candidate : "unknown";
  console.error("CITABOT_PROFESSIONAL_CHECKOUT_DB_FAILED", JSON.stringify({ operation, code }));
  throw new Error("DATABASE_OPERATION_FAILED");
}

function isCancelled(status: string | null) {
  return status === "cancelled" || status === "canceled";
}

async function checkPreapproval(id: string): Promise<{
  status: string | null;
  initPoint: string | null;
  payerId: string | null;
  nextPaymentDate: string | null;
  httpStatus: number | null;
}> {
  try {
    const response = await fetch("https://api.mercadopago.com/preapproval/" + encodeURIComponent(id), {
      headers: { Authorization: "Bearer " + MP_TOKEN },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("CITABOT_PROFESSIONAL_PREAPPROVAL_LOOKUP_FAILED", JSON.stringify({ status: response.status }));
      return { status: null, initPoint: null, payerId: null, nextPaymentDate: null, httpStatus: response.status };
    }
    return {
      status: typeof data?.status === "string" ? data.status : null,
      initPoint: typeof data?.init_point === "string" && data.init_point ? data.init_point : null,
      payerId: data?.payer_id == null ? null : String(data.payer_id),
      nextPaymentDate: typeof data?.next_payment_date === "string" ? data.next_payment_date : null,
      httpStatus: response.status,
    };
  } catch {
    console.error("CITABOT_PROFESSIONAL_PREAPPROVAL_LOOKUP_FAILED", JSON.stringify({ code: "network_error" }));
    return { status: null, initPoint: null, payerId: null, nextPaymentDate: null, httpStatus: null };
  }
}

async function cancelAndVerifyPreapproval(id: string): Promise<{ confirmedCancelled: boolean; status: string | null }> {
  try {
    const response = await fetch("https://api.mercadopago.com/preapproval/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { Authorization: "Bearer " + MP_TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "canceled" }),
    });
    if (!response.ok) {
      console.error("CITABOT_PROFESSIONAL_CANCEL_REQUEST_FAILED", JSON.stringify({ status: response.status }));
    }
  } catch {
    console.error("CITABOT_PROFESSIONAL_CANCEL_REQUEST_FAILED", JSON.stringify({ code: "network_error" }));
  }
  const verified = await checkPreapproval(id);
  return { confirmedCancelled: isCancelled(verified.status), status: verified.status };
}

async function setChangeReconciliation(id: string, values: {
  state: ReconciliationState;
  phase: ReconciliationPhase;
  new_subscription_id?: string | null;
  error_code?: string | null;
}) {
  const payload: Record<string, unknown> = { ...values, updated_at: new Date().toISOString() };
  if (values.state === "resolved") payload.resolved_at = new Date().toISOString();
  const { data, error } = await admin.from("subscription_change_reconciliation")
    .update(payload).eq("id", id).select("id").maybeSingle();
  throwOnDbError("reconciliation_update", error);
  if (!data?.id) throw new Error("RECONCILIATION_RECORD_MISSING");
}

async function restoreSubscriptionSnapshot(
  businessId: string,
  snapshot: SubscriptionSnapshot | null,
  newSubscriptionId: string
) {
  if (!snapshot) {
    const result = await admin.from("subscriptions").delete()
      .eq("business_id", businessId).eq("provider_subscription_id", newSubscriptionId);
    throwOnDbError("restore_empty_subscription", result.error);
    return;
  }
  const prior = {
    plan: snapshot.plan,
    status: snapshot.status,
    trial_started_at: snapshot.trial_started_at ?? null,
    trial_ends_at: snapshot.trial_ends_at ?? null,
    current_period_end: snapshot.current_period_end ?? null,
    provider: snapshot.provider ?? null,
    provider_customer_id: snapshot.provider_customer_id ?? null,
    provider_subscription_id: snapshot.provider_subscription_id ?? null,
    updated_at: new Date().toISOString(),
  };
  const result = await admin.from("subscriptions").update(prior)
    .eq("id", snapshot.id).eq("business_id", businessId).select("id").maybeSingle();
  throwOnDbError("restore_subscription_snapshot", result.error);
  if (!result.data?.id) throw new Error("SUBSCRIPTION_SNAPSHOT_RESTORE_MISSING");
}

async function reserveCheckout(businessId: string, prior: SubscriptionSnapshot | null) {
  const { data, error } = await admin.from("subscription_change_reconciliation").insert({
    business_id: businessId,
    provider: "mercadopago",
    previous_plan: prior?.plan ?? null,
    previous_subscription_id: prior?.provider_subscription_id ?? null,
    new_plan: "professional",
    new_subscription_id: null,
    previous_subscription: prior,
    state: "in_progress",
    phase: "initiating",
    updated_at: new Date().toISOString(),
  }).select("id").single();
  if (error?.code === "23505") return { id: null, conflict: true };
  throwOnDbError("reconciliation_reservation", error);
  if (!data?.id) throw new Error("RECONCILIATION_RESERVATION_MISSING");
  return { id: String(data.id), conflict: false };
}

async function hasUnresolvedCheckout(businessId: string) {
  const { data, error } = await admin.from("subscription_change_reconciliation")
    .select("id,phase,state,new_subscription_id")
    .eq("business_id", businessId)
    .in("state", ["in_progress", "reconciliation_required"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  throwOnDbError("unresolved_reconciliation_lookup", error);
  return data || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  try {
    if (!MP_TOKEN) return json({ ok: false, error: "Mercado Pago todavía no está configurado en el servidor." }, 503);
    const header = req.headers.get("authorization") || "";
    const token = header.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "Sesión requerida." }, 401);
    const { data: { user }, error: userError } = await admin.auth.getUser(token);
    if (userError || !user) return json({ ok: false, error: "Sesión inválida." }, 401);

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      body = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return json({ ok: false, error: "El cuerpo de la solicitud no es JSON válido." }, 400);
    }

    const businessId = String(body.business_id || "").trim();
    const plan = String(body.plan || "professional").trim().toLowerCase();
    if (!businessId) return json({ ok: false, error: "Negocio requerido." }, 400);
    if (plan !== "professional") return json({ ok: false, error: "Plan todavía no configurado para cobro automático." }, 400);

    const { data: member, error: memberError } = await admin.from("business_members")
      .select("role").eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
    throwOnDbError("business_membership_lookup", memberError);
    if (!member || !["owner", "admin"].includes(member.role)) {
      return json({ ok: false, error: "No tienes permisos para gestionar la suscripción." }, 403);
    }

    const payerEmail = String(body.payer_email || user.email || "").trim();
    if (payerEmail.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
      return json({ ok: false, error: "Necesitamos un correo válido para Mercado Pago." }, 400);
    }

    // An unresolved provider transition blocks both plan-change endpoints.
    // This check gives a helpful response; the unique partial index below is the
    // actual cross-request lock and closes the concurrent-request race.
    const unresolved = await hasUnresolvedCheckout(businessId);
    if (unresolved?.id) {
      return json({
        ok: false,
        error: "Hay un cambio de suscripción pendiente de conciliación. No inicies otro cambio hasta que se revise.",
        reconciliation_reference: unresolved.id,
      }, 409);
    }

    const existingResult = await admin.from("subscriptions").select("*")
      .eq("business_id", businessId).maybeSingle();
    throwOnDbError("existing_subscription_lookup", existingResult.error);
    const prior = (existingResult.data || null) as SubscriptionSnapshot | null;

    // Recover the same provider checkout instead of creating a second one when
    // the user retries after losing the original response.
    if (prior?.provider_subscription_id && ["active", "pending"].includes(prior.status)) {
      const remote = await checkPreapproval(String(prior.provider_subscription_id));
      if (remote.status === "authorized") {
        if (prior.status !== "active") {
          const mark = await admin.from("subscriptions").update({
            status: "active", updated_at: new Date().toISOString(),
          }).eq("id", prior.id).select("id").maybeSingle();
          throwOnDbError("confirmed_subscription_status_update", mark.error);
          if (!mark.data?.id) throw new Error("CONFIRMED_SUBSCRIPTION_UPDATE_MISSING");
        }
        return json({ ok: true, already_active: true, plan: prior.plan, subscription_id: prior.provider_subscription_id, status: "active" });
      }
      if (remote.status === "pending" && remote.initPoint) {
        if (prior.status !== "pending") {
          const mark = await admin.from("subscriptions").update({
            status: "pending", updated_at: new Date().toISOString(),
          }).eq("id", prior.id).select("id").maybeSingle();
          throwOnDbError("pending_subscription_status_update", mark.error);
          if (!mark.data?.id) throw new Error("PENDING_SUBSCRIPTION_UPDATE_MISSING");
        }
        return json({
          ok: true, already_pending: true, subscription_id: prior.provider_subscription_id,
          init_point: remote.initPoint, status: "pending", plan: prior.plan, amount: prior.plan === "premium" ? 69900 : 59900,
        });
      }
      if (isCancelled(remote.status)) {
        const mark = await admin.from("subscriptions").update({
          status: "cancelled", updated_at: new Date().toISOString(),
        }).eq("id", prior.id).select("id").maybeSingle();
        throwOnDbError("cancelled_subscription_status_update", mark.error);
        if (!mark.data?.id) throw new Error("CANCELLED_SUBSCRIPTION_UPDATE_MISSING");
      } else {
        return json({
          ok: false,
          error: "No pudimos confirmar el estado de la suscripción existente. No se creó otra suscripción; vuelve a intentarlo más tarde.",
        }, 503);
      }
    }

    let reservation: { id: string | null; conflict: boolean };
    try {
      reservation = await reserveCheckout(businessId, prior);
    } catch (error) {
      logCheckoutFailure("CITABOT_PROFESSIONAL_RECONCILIATION_RESERVATION_FAILED", error);
      return json({ ok: false, error: "No se pudo reservar el cambio de suscripción. No se creó una nueva suscripción." }, 503);
    }
    if (!reservation.id) {
      const pending = await hasUnresolvedCheckout(businessId);
      return json({
        ok: false,
        error: "Ya existe un cambio de suscripción en curso. No se creó una segunda suscripción.",
        ...(pending?.id ? { reconciliation_reference: pending.id } : {}),
      }, 409);
    }
    const reconciliationId = reservation.id;

    let createResponse: Response;
    try {
      createResponse = await fetch("https://api.mercadopago.com/preapproval", {
        method: "POST",
        headers: { Authorization: "Bearer " + MP_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "CitaBot Profesional",
          external_reference: "citabot:" + businessId,
          payer_email: payerEmail,
          auto_recurring: { frequency: 1, frequency_type: "months", transaction_amount: 59900, currency_id: "COP" },
          back_url: PUBLIC_URL,
          status: "pending",
        }),
      });
    } catch {
      await setChangeReconciliation(reconciliationId, {
        state: "reconciliation_required", phase: "rollback_unconfirmed", error_code: "PROVIDER_CREATE_STATE_UNKNOWN",
      });
      return json({
        ok: false,
        error: "No se pudo confirmar si Mercado Pago recibió la solicitud. No intentes otro cambio hasta revisar esta referencia.",
        reconciliation_required: true,
        reconciliation_reference: reconciliationId,
      }, 503);
    }

    const providerData = await createResponse.json().catch(() => ({}));
    if (!createResponse.ok) {
      await setChangeReconciliation(reconciliationId, {
        state: "resolved", phase: "finished", new_subscription_id: null, error_code: "PROVIDER_CREATE_REJECTED",
      });
      console.error("CITABOT_PROFESSIONAL_PREAPPROVAL_CREATE_FAILED", JSON.stringify({ status: createResponse.status }));
      return json({ ok: false, error: "Mercado Pago no pudo crear la solicitud Profesional. El plan actual no se modificó." }, 502);
    }

    const newProviderId = providerData?.id == null ? "" : String(providerData.id);
    const initPoint = typeof providerData?.init_point === "string" && providerData.init_point ? providerData.init_point : null;
    if (!newProviderId) {
      await setChangeReconciliation(reconciliationId, {
        state: "reconciliation_required", phase: "rollback_unconfirmed", new_subscription_id: null, error_code: "PROVIDER_ID_MISSING",
      });
      return json({
        ok: false,
        error: "Mercado Pago no devolvió el identificador de la solicitud. No completes ningún pago ni inicies otro cambio.",
        reconciliation_required: true,
        reconciliation_reference: reconciliationId,
      }, 503);
    }

    // Persist the provider ID in the durable lock before changing local plan
    // state. If the write fails, cancel at the provider and verify the result.
    try {
      await setChangeReconciliation(reconciliationId, {
        state: "in_progress", phase: "provider_created", new_subscription_id: newProviderId, error_code: null,
      });
    } catch (error) {
      logCheckoutFailure("CITABOT_PROFESSIONAL_PROVIDER_ID_PERSIST_FAILED", error);
      const rollback = await cancelAndVerifyPreapproval(newProviderId);
      let stored = false;
      try {
        await setChangeReconciliation(reconciliationId, {
          state: rollback.confirmedCancelled ? "resolved" : "reconciliation_required",
          phase: rollback.confirmedCancelled ? "rolled_back" : "rollback_unconfirmed",
          new_subscription_id: newProviderId,
          error_code: rollback.confirmedCancelled ? "PROVIDER_ID_PERSIST_FAILED" : "PROVIDER_ID_PERSIST_AND_ROLLBACK_UNCONFIRMED",
        });
        stored = true;
      } catch (recordError) {
        logCheckoutFailure("CITABOT_PROFESSIONAL_PROVIDER_ID_ROLLBACK_RECORD_FAILED", recordError);
      }
      if (rollback.confirmedCancelled && stored) {
        return json({ ok: false, error: "No se pudo registrar la nueva solicitud y se confirmó su cancelación. El plan anterior no se modificó." }, 503);
      }
      return json({
        ok: false,
        error: "No se pudo guardar la referencia ni confirmar su cancelación. No completes el pago ni inicies otro cambio.",
        reconciliation_required: true,
        reconciliation_reference: reconciliationId,
      }, 503);
    }

    if (!initPoint) {
      const rollback = await cancelAndVerifyPreapproval(newProviderId);
      if (rollback.confirmedCancelled) {
        await setChangeReconciliation(reconciliationId, {
          state: "resolved", phase: "rolled_back", new_subscription_id: newProviderId, error_code: "INIT_POINT_MISSING",
        });
        return json({ ok: false, error: "Mercado Pago no devolvió un enlace válido. La nueva solicitud fue cancelada y el plan anterior no se modificó." }, 502);
      }
      await setChangeReconciliation(reconciliationId, {
        state: "reconciliation_required", phase: "rollback_unconfirmed", new_subscription_id: newProviderId,
        error_code: "INIT_POINT_MISSING_ROLLBACK_UNCONFIRMED",
      });
      return json({
        ok: false,
        error: "Mercado Pago no devolvió el enlace y no pudimos confirmar la cancelación. No completes ningún pago ni inicies otro cambio.",
        reconciliation_required: true,
        reconciliation_reference: reconciliationId,
      }, 503);
    }

    const row = {
      business_id: businessId,
      plan: "professional",
      status: "pending",
      provider: "mercadopago",
      provider_customer_id: providerData?.payer_id == null ? null : String(providerData.payer_id),
      provider_subscription_id: newProviderId,
      current_period_end: providerData?.next_payment_date || null,
      updated_at: new Date().toISOString(),
    };

    try {
      if (prior) {
        const write = await admin.from("subscriptions").update(row)
          .eq("id", prior.id).eq("business_id", businessId).select("id").maybeSingle();
        throwOnDbError("save_professional_pending", write.error);
        if (!write.data?.id) throw new Error("PROFESSIONAL_PENDING_SAVE_MISSING");
      } else {
        const write = await admin.from("subscriptions").insert(row).select("id").single();
        throwOnDbError("save_professional_pending", write.error);
        if (!write.data?.id) throw new Error("PROFESSIONAL_PENDING_SAVE_MISSING");
      }
      await setChangeReconciliation(reconciliationId, {
        state: "in_progress", phase: "local_pending_saved", new_subscription_id: newProviderId, error_code: null,
      });
    } catch (error) {
      logCheckoutFailure("CITABOT_PROFESSIONAL_LOCAL_SAVE_FAILED", error);
      let snapshotRestored = false;
      try {
        await restoreSubscriptionSnapshot(businessId, prior, newProviderId);
        snapshotRestored = true;
      } catch (restoreError) {
        logCheckoutFailure("CITABOT_PROFESSIONAL_SNAPSHOT_RESTORE_FAILED", restoreError);
      }
      const rollback = await cancelAndVerifyPreapproval(newProviderId);
      if (snapshotRestored && rollback.confirmedCancelled) {
        await setChangeReconciliation(reconciliationId, {
          state: "resolved", phase: "rolled_back", new_subscription_id: newProviderId, error_code: "LOCAL_SAVE_FAILED",
        });
        return json({ ok: false, error: "No se pudo guardar la suscripción. El nuevo intento fue cancelado y se restauró el estado anterior." }, 503);
      }
      await setChangeReconciliation(reconciliationId, {
        state: "reconciliation_required",
        phase: snapshotRestored ? "rollback_unconfirmed" : "local_restore_failed",
        new_subscription_id: newProviderId,
        error_code: snapshotRestored ? "LOCAL_SAVE_ROLLBACK_UNCONFIRMED" : "LOCAL_RESTORE_FAILED",
      });
      return json({
        ok: false,
        error: "No se pudo confirmar la reversión del cambio. No completes el pago ni inicies otro cambio.",
        reconciliation_required: true,
        reconciliation_reference: reconciliationId,
      }, 503);
    }

    try {
      await setChangeReconciliation(reconciliationId, {
        state: "resolved", phase: "finished", new_subscription_id: newProviderId, error_code: null,
      });
    } catch (error) {
      logCheckoutFailure("CITABOT_PROFESSIONAL_RECONCILIATION_FINISH_FAILED", error);
      return json({
        ok: false,
        error: "La solicitud se guardó, pero su conciliación requiere revisión. No inicies otro cambio ni completes un nuevo pago.",
        reconciliation_required: true,
        reconciliation_reference: reconciliationId,
      }, 503);
    }

    return json({
      ok: true, subscription_id: newProviderId, init_point: initPoint, status: "pending", plan: "professional", amount: 59900,
    });
  } catch (error) {
    logCheckoutFailure("CITABOT_PROFESSIONAL_CHECKOUT_FAILED", error);
    return json({ ok: false, error: "No se pudo completar la operación comercial. Inténtalo de nuevo más tarde." }, 500);
  }
});
