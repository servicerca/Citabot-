import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261012060000_citabot_harden_onboarding_rpc_security_definer.sql",
  "utf8"
);

assert.match(
  migration,
  /ALTER FUNCTION public\.create_citabot_business_onboarding\(text, text, text, text, text\)\s+SECURITY DEFINER/i,
  "onboarding RPC must run with controlled definer privileges to create the protected trial subscription"
);
assert.match(
  migration,
  /SET search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/i,
  "the security-definer RPC must pin a hardened search_path"
);
assert.match(
  migration,
  /REVOKE ALL ON FUNCTION public\.create_citabot_business_onboarding\(text, text, text, text, text\)\s+FROM PUBLIC, anon/i,
  "the onboarding RPC must not be executable by public or anonymous callers"
);
assert.match(
  migration,
  /GRANT EXECUTE ON FUNCTION public\.create_citabot_business_onboarding\(text, text, text, text, text\)\s+TO authenticated/i,
  "only authenticated users should receive execute access to onboarding"
);
assert.doesNotMatch(
  migration,
  /GRANT\s+INSERT\s+ON\s+TABLE\s+public\.subscriptions\s+TO\s+(?:PUBLIC|anon|authenticated)/i,
  "do not solve onboarding by exposing client inserts into subscriptions"
);

console.log("CitaBot onboarding RPC security migration guard: OK");
