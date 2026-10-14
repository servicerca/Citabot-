-- Keep authenticated users from bypassing the atomic onboarding RPC.
-- The client has no direct insert flow for businesses or memberships; the RPC
-- is the only supported path for first-business creation and trial provisioning.
-- This prevents authenticated callers from inserting arbitrary businesses and
-- owner memberships outside the duplicate-onboarding guard.
REVOKE INSERT ON TABLE public.businesses FROM PUBLIC, anon, authenticated;
REVOKE INSERT ON TABLE public.business_members FROM PUBLIC, anon, authenticated;
