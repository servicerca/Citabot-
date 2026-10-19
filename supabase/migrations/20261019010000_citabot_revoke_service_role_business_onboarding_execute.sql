-- The onboarding RPC is an authenticated-user flow: it requires auth.uid().
-- service_role does not need this entry point, and its privilege is unnecessary.
-- Preserve authenticated execution so the supported first-business flow keeps working.
REVOKE EXECUTE ON FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  FROM service_role;
