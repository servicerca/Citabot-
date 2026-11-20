import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [index, migration, helper, whatsapp] = await Promise.all([
  readFile(new URL("supabase/functions/citabot-ai/index.ts", root), "utf8"),
  readFile(new URL("supabase/migrations/20261112180000_citabot_ai_monthly_usage_limits.sql", root), "utf8"),
  readFile(new URL("supabase/functions/citabot-ai/ai-usage-policy.ts", root), "utf8"),
  readFile(new URL("supabase/functions/citabot-whatsapp-webhook/index.ts", root), "utf8"),
]);
assert.match(index, /reserve_citabot_ai_request/);
assert.match(index, /record_citabot_ai_usage/);
assert.match(index, /decideAiQuota/);
assert.match(index, /quotaDecision\.maxOutputTokens/);
assert.match(whatsapp, /decideAiQuota/);
assert.match(whatsapp, /reserve_citabot_ai_request/);
assert.match(whatsapp, /record_citabot_ai_usage/);
assert.match(whatsapp, /max_output_tokens:quotaDecision\.maxOutputTokens/);
const whatsappAi = whatsapp.slice(whatsapp.indexOf("async function aiReply("), whatsapp.indexOf("\\nDeno.serve"));
assert.ok(whatsappAi.indexOf("reserve_citabot_ai_request") < whatsappAi.indexOf('fetch("https://api.openai.com/v1/responses")'),
  "WhatsApp must reserve monthly quota before calling the AI provider.");
assert.ok(whatsappAi.indexOf("if(!quotaDecision.allowed)") < whatsappAi.indexOf('fetch("https://api.openai.com/v1/responses")'),
  "WhatsApp must fail closed before the provider call when monthly quota is unavailable.");
assert.match(whatsappAi, /return automaticReply\(text,businessName\)/);
assert.match(helper, /AI_QUOTA_UNAVAILABLE/);
assert.ok(migration.includes("('professional', false, 0"));
assert.ok(migration.includes("('premium', false, 0"));
assert.match(migration, /REVOKE ALL ON FUNCTION public\.reserve_citabot_ai_request/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.reserve_citabot_ai_request.*TO service_role/);
assert.match(helper, /data\.allowed !== true/);
const client = await readFile(new URL("supabase/functions/citabot-ai/openai-client.ts", root), "utf8");
assert.match(client, /attempt <= 1/);
assert.doesNotMatch(client, /wait\(/);
console.log("CitaBot web and WhatsApp AI provider calls require atomic server-side monthly quota reservations: OK");
