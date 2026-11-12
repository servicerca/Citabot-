import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [index, migration, helper] = await Promise.all([
  readFile(new URL("supabase/functions/citabot-ai/index.ts", root), "utf8"),
  readFile(new URL("supabase/migrations/20261112180000_citabot_ai_monthly_usage_limits.sql", root), "utf8"),
  readFile(new URL("supabase/functions/citabot-ai/ai-usage-policy.ts", root), "utf8"),
]);
assert.match(index, /reserve_citabot_ai_request/);
assert.match(index, /record_citabot_ai_usage/);
assert.match(index, /decideAiQuota/);
assert.match(helper, /AI_QUOTA_UNAVAILABLE/);
assert.match(migration, /('professional', false, 0/);
assert.match(migration, /('premium', false, 0/);
assert.match(migration, /REVOKE ALL ON FUNCTION public\.reserve_citabot_ai_request/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.reserve_citabot_ai_request.*TO service_role/);
assert.match(helper, /data\.allowed !== true/);
console.log("CitaBot AI provider calls require an atomic server-side quota reservation: OK");
