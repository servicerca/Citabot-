SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
DO $$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM public.legal_acceptances;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'Owner should see only its business marketing-consent rows; got %', visible_count;
  END IF;
END
$$;

SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', false);
DO $$
DECLARE visible_count integer;
BEGIN
  SELECT count(*) INTO visible_count FROM public.legal_acceptances;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'Business staff should see only marketing-consent rows for their business; got %', visible_count;
  END IF;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.legal_acceptances(id,document,version,context,metadata)
    VALUES ('00000000-0000-4000-8000-000000000005','whatsapp','bad','public_booking_marketing','{"purpose":"marketing"}');
    RAISE EXCEPTION 'Authenticated users must not insert audit consents directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;
RESET ROLE;
