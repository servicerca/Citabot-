import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261019004000_citabot_revoke_trigger_function_execute.sql",
  "utf8"
);

assert.match(
  migration,
  /REVOKE EXECUTE ON FUNCTION public\.prevent_profile_role_escalation\(\)\s+FROM PUBLIC, anon, authenticated/i,
  "the trigger-only profile role function must not be directly executable by API roles"
);
assert.match(
  migration,
  /COMMENT ON FUNCTION public\.prevent_profile_role_escalation\(\)[\s\S]*Trigger-only profile role safeguard/i,
  "the database should document that the function is trigger-only"
);
assert.doesNotMatch(
  migration,
  /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.prevent_profile_role_escalation/i,
  "the trigger-only role guard must never be granted direct execution"
);

console.log("CitaBot trigger-only function privilege guard: OK");
