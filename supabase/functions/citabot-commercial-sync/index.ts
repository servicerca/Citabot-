import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const mp = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
if (!url || !key) throw new Error("Supabase server configuration missing");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function logBackendFailure(error: unknown) {
  const candidate = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : null;
  const code = typeof candidate === "string" && /^[A-Z0-9_]{1,20}$/.test(candidate)
    ? candidate
    : "unknown";
  console.error("CITABOT_COMMERCIAL_SYNC_ERROR", JSON.stringify({ code }));
}
function throwOnDbError(operation: string, error: { code?: unknown } | null | undefined) {
  if (!error) return;
  const candidate = error.code;
  const code = typeof candidate === "string" && /^[A-Z0-9_]{1,20}$/.test(candidate)
    ? candidate
    : "unknown";
  console.error("CITABOT_COMMERCIAL_SYNC_DB_FAILED", JSON.stringify({ operation, code }));
  throw new Error("DATABASE_OPERATION_FAILED");
}
async function getUser(req: Request) {
  const header = req.headers.get("authorization") || "";
  const jwt = header.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const result = await db.auth.getUser(jwt);
  return result.data.user || null;
}
async function mpGet(path: string) {
  if (!mp) throw new Error("MERCADOPAGO_NOT_CONFIGURED");
  const response = await fetch("https://api.mercadopago.com" + path, {
    headers: { Authorization: "Bearer " + mp },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("CITABOT_COMMERCIAL_SYNC_PROVIDER_FAILED", JSON.stringify({ status: response.status }));
    throw new Error("MERCADOPAGO_REQUEST_FAILED");
  }
  return data;
}
function subStatus(status: string) {
  return status === "authorized" ? "active"
    : status === "paused" ? "paused"
    : status === "cancelled" || status === "canceled" ? "cancelled"
    : status === "pending" ? "pending"
    : "past_due";
}
function paymentStatus(payment: any) {
  return payment?.status === "approved" ? "paid"
    : payment?.status === "refunded" ? "refunded"
    : payment?.status === "rejected" || payment?.status === "cancelled" ? "failed"
    : "pending";
}

async function syncBoostOrder(order: any, payment: any) {
  const transactionId = payment?.id == null ? "" : String(payment.id);
  if (!transactionId || transactionId === "undefined" || transactionId === "null") {
    throw new Error("PAYMENT_ID_MISSING");
  }

  const status = paymentStatus(payment);
  const amount = Number(payment?.transaction_amount ?? order.amount ?? 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("PAYMENT_AMOUNT_INVALID");
  const currency = String(payment?.currency_id || order.currency || "COP");
  const providerReference = payment?.order?.id ? String(payment.order.id) : order.provider_reference;
  const baseUpdate = {
    provider: "mercadopago",
    provider_reference: providerReference || null,
    provider_transaction_id: transactionId,
    updated_at: new Date().toISOString(),
  };

  if (status === "paid") {
    const startAt = order.starts_at ? new Date(order.starts_at) : new Date();
    const endAt = order.ends_at
      ? new Date(order.ends_at)
      : new Date(startAt.getTime() + Number(order.duration_days) * 86400000);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new Error("BOOST_ORDER_DATES_INVALID");
    }

    // Persist stable timestamps first but keep pending orders recoverable until
    // the directory entitlement and revenue entry are both safely written.
    const dates = await db.from("directory_boost_orders").update({
      ...baseUpdate,
      starts_at: startAt.toISOString(),
      ends_at: endAt.toISOString(),
    }).eq("id", order.id).select("id").maybeSingle();
    throwOnDbError("boost_order_dates", dates.error);
    if (!dates.data?.id) throw new Error("BOOST_ORDER_DATES_MISSING");

    const listing = await db.from("business_directory").update({
      featured: endAt.getTime() > Date.now(),
      featured_until: endAt.toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("business_id", order.business_id).select("business_id").maybeSingle();
    throwOnDbError("boost_directory_activation", listing.error);
    if (!listing.data?.business_id) throw new Error("BOOST_DIRECTORY_LISTING_MISSING");

    const revenue = await db.from("platform_revenue").upsert({
      business_id: order.business_id,
      source: "directory_boost",
      source_reference: transactionId,
      gross_amount: amount || Number(order.amount || 0),
      platform_fee: 0,
      currency,
      status: "paid",
    }, { onConflict: "source,source_reference" });
    throwOnDbError("boost_revenue", revenue.error);

    const finalized = await db.from("directory_boost_orders").update({
      ...baseUpdate,
      status: "paid",
      updated_at: new Date().toISOString(),
    }).eq("id", order.id).select("id").maybeSingle();
    throwOnDbError("boost_order_paid_status", finalized.error);
    if (!finalized.data?.id) throw new Error("BOOST_ORDER_PAID_STATUS_MISSING");
  } else if (status === "refunded") {
    const revenue = await db.from("platform_revenue").upsert({
      business_id: order.business_id,
      source: "directory_boost",
      source_reference: transactionId,
      gross_amount: amount || Number(order.amount || 0),
      platform_fee: 0,
      currency,
      status: "refunded",
    }, { onConflict: "source,source_reference" });
    throwOnDbError("boost_refund_revenue", revenue.error);

    if (order.ends_at) {
      const revoke = await db.from("business_directory").update({
        featured: false,
        featured_until: null,
        updated_at: new Date().toISOString(),
      }).eq("business_id", order.business_id)
        .eq("featured_until", order.ends_at)
        .select("business_id").maybeSingle();
      throwOnDbError("boost_refund_revoke", revoke.error);
      // No row means the listing no longer has this order's end date; a newer
      // promotion must be left untouched.
    }

    const finalized = await db.from("directory_boost_orders").update({
      ...baseUpdate,
      status: "refunded",
      updated_at: new Date().toISOString(),
    }).eq("id", order.id).select("id").maybeSingle();
    throwOnDbError("boost_refund_status", finalized.error);
    if (!finalized.data?.id) throw new Error("BOOST_REFUND_STATUS_MISSING");
  } else {
    const finalized = await db.from("directory_boost_orders").update({
      ...baseUpdate,
      status,
      updated_at: new Date().toISOString(),
    }).eq("id", order.id).select("id").maybeSingle();
    throwOnDbError("boost_order_status_update", finalized.error);
    if (!finalized.data?.id) throw new Error("BOOST_ORDER_STATUS_UPDATE_MISSING");
  }
  return { order_id: order.id, status, provider_transaction_id: transactionId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido." }, 405);

  try {
    const user = await getUser(req);
    if (!user) return json({ ok: false, error: "Sesión inválida." }, 401);

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "El cuerpo de la solicitud no es JSON válido." }, 400);
    }
    const businessId = String(body?.business_id || "").trim();
    if (!businessId) return json({ ok: false, error: "Negocio requerido." }, 400);

    const membership = await db.from("business_members").select("role")
      .eq("business_id", businessId).eq("user_id", user.id).maybeSingle();
    throwOnDbError("business_membership_lookup", membership.error);
    if (!membership.data || !["owner", "admin"].includes(membership.data.role)) {
      return json({ ok: false, error: "No autorizado." }, 403);
    }
    if (!mp) return json({ ok: false, error: "Mercado Pago no está configurado." }, 503);

    let premium: any = null;
    const boosts: any[] = [];

    const sub = await db.from("subscriptions")
      .select("id,plan,status,provider,provider_subscription_id")
      .eq("business_id", businessId).maybeSingle();
    throwOnDbError("subscription_lookup", sub.error);

    if (sub.data?.provider === "mercadopago" && sub.data.provider_subscription_id) {
      const remote = await mpGet("/preapproval/" + encodeURIComponent(String(sub.data.provider_subscription_id)));
      const status = subStatus(String(remote.status || "pending"));
      if (sub.data.status !== status) {
        const update = await db.from("subscriptions").update({
          status,
          current_period_end: remote?.next_payment_date || remote?.auto_recurring?.end_date || null,
          updated_at: new Date().toISOString(),
        }).eq("id", sub.data.id);
        throwOnDbError("subscription_status_update", update.error);
      }
      premium = { plan: sub.data.plan, status, provider_subscription_id: sub.data.provider_subscription_id };
      if (status === "active" && sub.data.plan === "premium") premium = { ...premium, verified: true };
    }

    const orders = await db.from("directory_boost_orders")
      .select("id,business_id,duration_days,amount,currency,status,provider,provider_reference,provider_transaction_id,starts_at,ends_at,created_at")
      .eq("business_id", businessId)
      .in("status", ["pending", "paid", "refunded"])
      .eq("provider", "mercadopago")
      .order("updated_at", { ascending: false })
      .limit(25);
    throwOnDbError("boost_order_lookup", orders.error);

    for (const order of orders.data || []) {
      let payment: any = null;
      if (order.provider_transaction_id) {
        payment = await mpGet("/v1/payments/" + encodeURIComponent(String(order.provider_transaction_id)));
      } else {
        const now = new Date();
        const orderCreatedAt = order.created_at ? new Date(order.created_at) : new Date(now.getTime() - 7 * 86400000);
        const begin = new Date(orderCreatedAt.getTime() - 86400000).toISOString();
        const end = new Date(now.getTime() + 86400000).toISOString();
        const path = "/v1/payments/search?sort=date_created&criteria=desc&external_reference="
          + encodeURIComponent("citabot-boost:" + order.id)
          + "&range=date_created&begin_date=" + encodeURIComponent(begin)
          + "&end_date=" + encodeURIComponent(end);
        const search = await mpGet(path);
        payment = (search?.results || []).find((candidate: any) =>
          ["approved", "refunded", "rejected", "cancelled", "pending", "in_process"].includes(candidate.status)
        );
      }
      if (!payment) continue;
      const synced = await syncBoostOrder(order, payment);
      boosts.push(synced);
    }

    return json({ ok: true, premium, boosts });
  } catch (error) {
    logBackendFailure(error);
    return json({
      ok: false,
      error: "No se pudo sincronizar el plan o las promociones. Inténtalo de nuevo más tarde.",
    }, 500);
  }
});
