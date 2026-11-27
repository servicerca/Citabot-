import { assertEquals } from "jsr:@std/assert@1";
import { verifyMercadoPagoAccessToken } from "./provider-credentials.ts";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("checks token with the read-only Mercado Libre identity endpoint", async () => {
  let requestedUrl = "";
  let requestedAuthorization = "";
  const result = await verifyMercadoPagoAccessToken("server-only-token", async (input, init) => {
    requestedUrl = String(input);
    requestedAuthorization = new Headers(init?.headers).get("Authorization") || "";
    return response({ id: 123, site_id: "MCO" });
  });

  assertEquals(requestedUrl, "https://api.mercadolibre.com/users/me");
  assertEquals(requestedAuthorization, "Bearer server-only-token");
  assertEquals(result, { ok: true, site_id: "MCO" });
});

Deno.test("never treats a missing or rejected token as available", async () => {
  let calls = 0;
  const missing = await verifyMercadoPagoAccessToken("", async () => {
    calls += 1;
    return response({ id: 1 });
  });
  const rejected = await verifyMercadoPagoAccessToken("bad-token", async () => response({}, 401));

  assertEquals(calls, 0);
  assertEquals(missing, { ok: false, code: "not_configured", http_status: null });
  assertEquals(rejected, { ok: false, code: "provider_rejected", http_status: 401 });
});

Deno.test("rejects a success response that contains no seller identity", async () => {
  const result = await verifyMercadoPagoAccessToken("token", async () => response({ status: "ok" }));
  assertEquals(result, { ok: false, code: "invalid_response", http_status: 200 });
});

Deno.test("reports a network failure without revealing token content", async () => {
  const result = await verifyMercadoPagoAccessToken("private-token-value", async () => {
    throw new Error("network failure");
  });
  assertEquals(result, { ok: false, code: "network_error", http_status: null });
});
