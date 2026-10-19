-- Recreate the unnecessary production service_role grant on a disposable CI database.
-- This deliberately runs BEFORE the security migration to prove that the migration removes it.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END;
$role$;

GRANT EXECUTE ON FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  TO service_role;
