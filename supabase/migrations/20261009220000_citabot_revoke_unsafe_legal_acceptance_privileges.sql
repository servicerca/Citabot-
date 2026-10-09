-- Legal acceptance history is append-only for application users.
-- Prevent table-level privileges that bypass row-level policies.
REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public.legal_acceptances FROM authenticated;
