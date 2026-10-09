-- Private helper functions must not inherit default EXECUTE rights for API roles.
-- SECURITY DEFINER wrappers and database triggers execute under their trusted owner,
-- while API roles should have no direct execution path into the private schema.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
