-- Harden the production onboarding RPC search_path after the SECURITY DEFINER audit.
-- This function intentionally runs as SECURITY DEFINER because client roles cannot
-- write the subscription row directly. It requires auth.uid(), validates input,
-- serializes first-business/trial creation, and schema-qualifies application tables.
-- Keep anon execution revoked; authenticated execution is required for onboarding.
ALTER FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  SET search_path = pg_catalog;

COMMENT ON FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text) IS
  'SECURITY DEFINER is intentional for atomic initial business onboarding and trial creation. Requires auth.uid(), validates inputs, serializes per-owner trial creation and slug allocation, and references application relations by schema-qualified names. Keep EXECUTE unavailable to anon; authenticated execution is required by the owner onboarding flow.';
