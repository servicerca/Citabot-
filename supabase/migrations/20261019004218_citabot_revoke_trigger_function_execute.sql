-- A trigger function is invoked by PostgreSQL through its trigger, not as an RPC.
-- API roles do not need direct EXECUTE privileges on this function.
REVOKE EXECUTE ON FUNCTION public.prevent_profile_role_escalation()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.prevent_profile_role_escalation() IS
  'Trigger-only profile role safeguard. API roles must not execute this function directly; PostgreSQL invokes it through trg_prevent_profile_role_escalation.';
