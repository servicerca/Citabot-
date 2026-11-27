export type MercadoPagoCredentialCheck =
  | { ok: true; site_id: string | null }
  | {
      ok: false;
      code: "not_configured" | "provider_rejected" | "invalid_response" | "network_error";
      http_status: number | null;
    };

/**
 * Validates a server-held Mercado Pago access token with a read-only account
 * identity endpoint. It does not create preferences, subscriptions, orders,
 * payments, or charges and never returns seller identifiers or token data.
 */
export async function verifyMercadoPagoAccessToken(
  accessToken: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<MercadoPagoCredentialCheck> {
  const token = String(accessToken || "").trim();
  if (!token) return { ok: false, code: "not_configured", http_status: null };

  try {
    const response = await fetcher("https://api.mercadolibre.com/users/me", {
      method: "GET",
      headers: { Authorization: "Bearer " + token },
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      return { ok: false, code: "provider_rejected", http_status: response.status };
    }
    if (
      !payload ||
      (typeof payload.id !== "number" && typeof payload.id !== "string") ||
      !String(payload.id).trim()
    ) {
      return { ok: false, code: "invalid_response", http_status: response.status };
    }
    const siteId = typeof payload.site_id === "string" ? payload.site_id.trim() : "";
    return { ok: true, site_id: siteId || null };
  } catch {
    return { ok: false, code: "network_error", http_status: null };
  }
}
