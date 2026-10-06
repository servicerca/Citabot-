-- Keep legal acceptance history append-only for authenticated clients.
-- Signup acceptance is written by the Auth trigger; booking acceptance is written by trusted backend functions.

revoke insert, update, delete on table public.legal_acceptances from authenticated;
