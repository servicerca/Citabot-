import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const url = Deno.env.get("SUPABASE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) {
  throw new Error("Supabase server configuration missing");
}

const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type SafeClientError = { status: number; message: string };

// Only known, deliberately authored business-rule messages may be returned to
// an unauthenticated caller. Unexpected PostgREST/Postgres errors stay private.
const CLIENT_BOOKING_ERRORS = new Map<string, SafeClientError>([
  ["Debes aceptar la política de privacidad para reservar", { status: 400, message: "Debes aceptar la política de privacidad para reservar." }],
  ["Debes aceptar el contacto por WhatsApp para gestionar esta reserva", { status: 400, message: "Debes aceptar el contacto por WhatsApp para gestionar esta reserva." }],
  ["Negocio no disponible", { status: 404, message: "Negocio no disponible." }],
  ["Servicio no disponible", { status: 404, message: "Servicio no disponible." }],
  ["Profesional no disponible", { status: 404, message: "Profesional no disponible." }],
  ["Fecha y hora requeridas", { status: 400, message: "Debes indicar la fecha y la hora." }],
  ["La fecha y hora deben ser futuras", { status: 400, message: "La fecha y hora deben ser futuras." }],
  ["La reserva no puede superar 365 días de anticipación", { status: 400, message: "La reserva no puede superar 365 días de anticipación." }],
  ["Nombre requerido", { status: 400, message: "Debes indicar tu nombre." }],
  ["Nombre demasiado largo", { status: 400, message: "El nombre es demasiado largo." }],
  ["WhatsApp requerido", { status: 400, message: "Debes indicar un número de WhatsApp." }],
  ["WhatsApp demasiado largo", { status: 400, message: "El número de WhatsApp es demasiado largo." }],
  ["Email demasiado largo", { status: 400, message: "El correo electrónico es demasiado largo." }],
  ["Nota demasiado larga", { status: 400, message: "La nota es demasiado larga." }],
  ["WhatsApp no válido", { status: 400, message: "El número de WhatsApp no es válido." }],
  ["El negocio está cerrado ese día", { status: 400, message: "El negocio está cerrado ese día." }],
  ["La hora está fuera del horario del negocio", { status: 400, message: "La hora está fuera del horario del negocio." }],
  ["Ese profesional ya tiene una cita en ese horario.", { status: 409, message: "Ese profesional ya tiene una cita en ese horario." }],
  ["Forma de pago no válida", { status: 400, message: "La forma de pago no es válida." }],
]);

class BookingDependencyUnavailable extends Error {
  constructor() {
    super("Public booking dependency unavailable");
    this.name = "BookingDependencyUnavailable";
  }
}

function safeRpcMessage(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function logBackendFailure(event: string, error: unknown) {
  const candidate = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : null;
  const code = typeof candidate === "string" && /^[A-Z0-9_]{1,20}$/.test(candidate)
    ? candidate
    : "unknown";
  // Never log raw SQL/PostgREST messages or request contents.
  console.error(event, JSON.stringify({ code }));
}

async function rateKey(req: Request, slug: string) {
  const raw = `${req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown"}|${slug}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function allowed(req: Request, slug: string, limit: number, windowSeconds: number) {
  const key = await rateKey(req, slug);
  const { data, error } = await db.rpc("consume_public_booking_rate_limit", {
    p_rate_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    logBackendFailure("PUBLIC_BOOKING_RATE_LIMIT_FAILED", error);
    throw new BookingDependencyUnavailable();
  }
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "Método no permitido." }, 405);
  }

  try {
    if (req.method === "GET") {
      const slug = new URL(req.url).searchParams.get("slug")?.trim().toLowerCase();
      if (!slug || !/^[a-z0-9-]{2,80}$/.test(slug)) {
        return json({ ok: false, error: "Slug inválido." }, 400);
      }

      if (!(await allowed(req, slug, 60, 300))) {
        return json({ ok: false, error: "Demasiadas solicitudes. Inténtalo de nuevo en unos minutos." }, 429);
      }

      const { data, error } = await db.rpc("get_public_booking", { p_business_slug: slug });
      if (error) {
        if (safeRpcMessage(error) === "Negocio no disponible") {
          return json({ ok: false, error: "Negocio no disponible." }, 404);
        }
        logBackendFailure("PUBLIC_BOOKING_LOOKUP_FAILED", error);
        return json({
          ok: false,
          error: "No se pudo cargar la información de reservas. Inténtalo de nuevo más tarde.",
        }, 503);
      }

      if (data && Array.isArray(data.staff) && data.staff.length === 0) {
        data.staff = [{ id: "", name: "Sin profesional asignado" }];
      }
      return json({ ok: true, data });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, error: "El cuerpo de la solicitud no es JSON válido." }, 400);
    }

    const input = body !== null && typeof body === "object"
      ? body as Record<string, unknown>
      : {};
    const slug = String(input.business_slug ?? "").trim().toLowerCase();
    const serviceId = String(input.service_id ?? "").trim();
    const staffRaw = input.staff_id == null ? "" : String(input.staff_id).trim();
    const customerName = String(input.customer_name ?? "").trim();
    const customerPhone = String(input.customer_phone ?? "").trim();
    const customerEmail = input.customer_email == null ? "" : String(input.customer_email).trim();
    const startsAt = String(input.starts_at ?? "").trim();
    const customerNotes = input.customer_notes == null ? "" : String(input.customer_notes).trim();
    const paymentMethod = String(input.payment_method ?? "cash").trim().toLowerCase();
    const privacyConsent = input.privacy_consent === true;
    const whatsappConsent = input.whatsapp_consent === true;

    if (!/^[a-z0-9-]{2,80}$/.test(slug)) return json({ ok: false, error: "Negocio inválido." }, 400);
    if (!serviceId || !customerName || !customerPhone || !startsAt) {
      return json({ ok: false, error: "Faltan datos obligatorios." }, 400);
    }
    if (!privacyConsent || !whatsappConsent) {
      return json({ ok: false, error: "Debes aceptar privacidad y el uso de WhatsApp para gestionar la reserva." }, 400);
    }
    if (customerName.length > 120 || customerPhone.length > 40 || customerEmail.length > 160 || customerNotes.length > 1000) {
      return json({ ok: false, error: "Datos demasiado largos." }, 400);
    }
    if (!["cash", "transfer", "other"].includes(paymentMethod)) {
      return json({ ok: false, error: "Forma de pago no válida." }, 400);
    }
    if (!(await allowed(req, slug, 10, 300))) {
      return json({ ok: false, error: "Demasiadas reservas desde este origen. Inténtalo de nuevo más tarde." }, 429);
    }

    const parsed = new Date(startsAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return json({ ok: false, error: "La fecha y hora deben ser futuras." }, 400);
    }
    if (parsed.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
      return json({ ok: false, error: "La reserva no puede superar 365 días de anticipación." }, 400);
    }

    const { data, error } = await db.rpc("book_appointment_v3", {
      p_business_slug: slug,
      p_service_id: serviceId,
      p_staff_id: staffRaw || null,
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_customer_email: customerEmail || null,
      p_starts_at: parsed.toISOString(),
      p_customer_notes: customerNotes || null,
      p_privacy_consent: privacyConsent,
      p_whatsapp_consent: whatsappConsent,
      p_payment_method: paymentMethod,
    });

    if (error) {
      const known = CLIENT_BOOKING_ERRORS.get(safeRpcMessage(error) ?? "");
      if (known) return json({ ok: false, error: known.message }, known.status);

      logBackendFailure("PUBLIC_BOOKING_CREATE_FAILED", error);
      return json({
        ok: false,
        error: "No se pudo completar la reserva. Inténtalo de nuevo más tarde.",
      }, 503);
    }

    return json({ ok: true, appointment_id: data });
  } catch (error) {
    if (error instanceof BookingDependencyUnavailable) {
      return json({
        ok: false,
        error: "El servicio de reservas no está disponible. Inténtalo de nuevo más tarde.",
      }, 503);
    }
    logBackendFailure("PUBLIC_BOOKING_UNEXPECTED_FAILURE", error);
    return json({
      ok: false,
      error: "No se pudo procesar la solicitud. Inténtalo de nuevo más tarde.",
    }, 500);
  }
});
