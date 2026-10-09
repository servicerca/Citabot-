-- Revoke table-level privileges that bypass the intended row-level audit history protections.
REVOKE REFERENCES, TRIGGER, TRUNCATE ON TABLE public.legal_acceptances FROM authenticated;
