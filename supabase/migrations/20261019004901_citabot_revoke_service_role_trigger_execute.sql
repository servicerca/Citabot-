-- The service role also received an explicit EXECUTE grant on this trigger-only function.
-- PostgreSQL invokes the function through the existing trigger; direct execution is unnecessary.
REVOKE EXECUTE ON FUNCTION public.prevent_profile_role_escalation()
  FROM service_role;

COMMENT ON FUNCTION public.prevent_profile_role_escalation() IS
  'Trigger-only profile role safeguard. PostgreSQL invokes this function through trg_prevent_profile_role_escalation; API roles and service_role must not execute it directly.';
