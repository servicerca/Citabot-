import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261012060302_citabot_harden_onboarding_rpc_security_definer.sql",
  "utf8"
);

const directWriteMigration = readFileSync(
  "supabase/migrations/20261014015651_citabot_revoke_direct_business_creation.sql",
  "utf8"
);

const onboardingImplementation = readFileSync(
  "supabase/migrations/20261013045141_citabot_guard_onboarding_retries_and_slug_collisions.sql",
  "utf8"
);
const searchPathHardening = readFileSync(
  "supabase/migrations/20261016231136_harden_citabot_business_onboarding_search_path.sql",
  "utf8"
);

const serviceRoleRevocation = readFileSync(
  "supabase/migrations/20261019010000_citabot_revoke_service_role_business_onboarding_execute.sql",
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

assert.match(
  onboardingImplementation,
  /CREATE OR REPLACE FUNCTION public\.create_citabot_business_onboarding\(/i,
  "the implementation covered by the guard must be the actual onboarding RPC body"
);
assert.match(
  onboardingImplementation,
  /v_user_id uuid := auth\.uid\(\)/i,
  "the RPC owner must come from Supabase auth.uid(), never from a caller-supplied owner id"
);
assert.match(
  onboardingImplementation,
  /IF v_user_id IS NULL THEN\s+RAISE EXCEPTION 'Sesión requerida'/i,
  "the definer function must reject a request with no authenticated user"
);
assert.match(
  onboardingImplementation,
  /IF EXISTS \([\s\S]*FROM public\.businesses b[\s\S]*WHERE b\.owner_id = v_user_id[\s\S]*\) THEN\s+RAISE EXCEPTION/i,
  "an owner with a business must not obtain another free trial through repeated RPC calls"
);
const ownerLockAt = onboardingImplementation.indexOf("citabot-user-onboarding:");
const ownerCheckAt = onboardingImplementation.indexOf("WHERE b.owner_id = v_user_id");
assert.ok(ownerLockAt >= 0 && ownerCheckAt > ownerLockAt, "per-owner advisory lock must precede the duplicate-onboarding check");
assert.match(
  onboardingImplementation,
  /pg_advisory_xact_lock\([\s\S]*citabot-business-slug:/i,
  "slug allocation must be serialized to prevent concurrent duplicate slugs"
);
assert.match(
  onboardingImplementation,
  /INSERT INTO public\.businesses\([\s\S]*owner_id, name, slug[\s\S]*VALUES \([\s\S]*v_user_id/i,
  "the new business must be assigned to the authenticated owner"
);
assert.match(
  onboardingImplementation,
  /INSERT INTO public\.business_members\(business_id, user_id, role\)\s+VALUES \(v_business\.id, v_user_id, 'owner'\)/i,
  "the owner membership must be assigned to that same authenticated user"
);
assert.match(
  onboardingImplementation,
  /INSERT INTO public\.subscriptions\([\s\S]*business_id, plan, status[\s\S]*VALUES \([\s\S]*v_business\.id, 'trial', 'trialing'/i,
  "trial subscription creation must be atomic and bound to the newly created owned business"
);
assert.match(
  searchPathHardening,
  /ALTER FUNCTION public\.create_citabot_business_onboarding\(text, text, text, text, text\)\s+SET search_path = pg_catalog/i,
  "latest production hardening must pin the definer search_path to pg_catalog"
);
assert.match(
  searchPathHardening,
  /COMMENT ON FUNCTION public\.create_citabot_business_onboarding[\s\S]*authenticated execution is required/i,
  "the intentional authenticated-only definer exception must explain its owner-bound onboarding safeguards"
);

  
assert.match(
  serviceRoleRevocation,
  /REVOKE EXECUTE ON FUNCTION public\\.create_citabot_business_onboarding\\(text,\\s*text,\\s*text,\\s*text,\\s*text\\)\\s+FROM service_role/i,
  "service_role must not execute the owner-bound onboarding RPC directly"
);

assert.match(
  directWriteMigration,
  /REVOKE INSERT ON TABLE public\.businesses FROM PUBLIC, anon, authenticated/i,
  "authenticated clients must not bypass atomic onboarding by inserting businesses directly"
);
assert.match(
  directWriteMigration,
  /REVOKE INSERT ON TABLE public\.business_members FROM PUBLIC, anon, authenticated/i,
  "authenticated clients must not create owner memberships outside the onboarding RPC"
);
console.log("CitaBot onboarding RPC security migration guard: OK");
