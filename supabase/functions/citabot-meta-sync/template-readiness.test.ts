import { assertEquals } from "jsr:@std/assert@1";
import { readApprovedMarketingTemplates } from "./template-readiness.ts";

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("keeps only approved marketing templates and does not mistake utility templates", async () => {
  const result = await readApprovedMarketingTemplates("waba-123", "secret-token", async () =>
    response({
      data: [
        { name: "winback_30", language: "es_CO", status: "APPROVED", category: "MARKETING" },
        { name: "pending_sale", language: "es_CO", status: "PENDING", category: "MARKETING" },
        { name: "appointment_reminder", language: "es_CO", status: "APPROVED", category: "UTILITY" },
        { name: "bad name", language: "es_CO", status: "APPROVED", category: "MARKETING" },
      ],
    })
  );

  assertEquals(result.checked, true);
  if (!result.checked) throw new Error("Expected a successful template check");
  assertEquals(result.complete, true);
  assertEquals(result.approved_marketing_templates, [
    { name: "winback_30", language: "es_CO" },
  ]);
});

Deno.test("follows provider cursors and deduplicates templates", async () => {
  const requests: string[] = [];
  const result = await readApprovedMarketingTemplates("waba-123", "secret-token", async (input) => {
    const url = String(input);
    requests.push(url);
    if (requests.length === 1) {
      return response({
        data: [{ name: "winback_30", language: "es_CO", status: "APPROVED", category: "MARKETING" }],
        paging: { next: "https://graph.facebook.com/next", cursors: { after: "cursor-2" } },
      });
    }
    return response({
      data: [{ name: "winback_30", language: "es_CO", status: "APPROVED", category: "MARKETING" }],
    });
  });

  assertEquals(requests.length, 2);
  assertEquals(new URL(requests[1]).searchParams.get("after"), "cursor-2");
  assertEquals(result.checked, true);
  if (!result.checked) throw new Error("Expected a successful template check");
  assertEquals(result.approved_marketing_templates.length, 1);
  assertEquals(result.complete, true);
});

Deno.test("reports Meta permission errors without treating campaigns as ready", async () => {
  const result = await readApprovedMarketingTemplates("waba-123", "secret-token", async () =>
    response({ error: { code: 200, message: "missing permission" } }, 403)
  );

  assertEquals(result, {
    checked: false,
    meta_status: 403,
    meta_code: 200,
    reason: "permission_or_provider_error",
  });
});

Deno.test("caps pagination and marks an incomplete scan", async () => {
  let calls = 0;
  const result = await readApprovedMarketingTemplates("waba-123", "secret-token", async () => {
    calls += 1;
    return response({
      data: [],
      paging: { next: "https://graph.facebook.com/next", cursors: { after: "cursor-" + calls } },
    });
  });

  assertEquals(calls, 5);
  assertEquals(result.checked, true);
  if (!result.checked) throw new Error("Expected a successful template check");
  assertEquals(result.complete, false);
});

Deno.test("does not call Meta when identifiers are missing", async () => {
  let calls = 0;
  const result = await readApprovedMarketingTemplates("", "secret-token", async () => {
    calls += 1;
    return response({ data: [] });
  });

  assertEquals(calls, 0);
  assertEquals(result.checked, false);
});
