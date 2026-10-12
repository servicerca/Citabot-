-- CitaBot: onboarding creates the initial trial subscription server-side.
-- The RPC validates auth.uid() and fixes owner_id/user_id to the caller.
-- SECURITY DEFINER is required because application roles intentionally cannot
-- insert directly into the protected subscriptions table.
ALTER FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  SECURITY DEFINER;

-- Keep built-ins first and temporary schema last to prevent object shadowing.
ALTER FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  SET search_path = pg_catalog, public, pg_temp;

-- Maintain the intended narrow RPC surface: signed-in users only.
REVOKE ALL ON FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  TO authenticated;
