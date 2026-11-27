DO $$
BEGIN
  BEGIN
    INSERT INTO public.business_integrations(business_id,provider,whatsapp_phone_number_id,enabled)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','whatsapp','100000000003',false);
    RAISE EXCEPTION 'A second WhatsApp connection for the same business must be rejected';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END
$$;

-- Different businesses may each connect WhatsApp, and the same business
-- may continue to use other providers.
INSERT INTO public.business_integrations(business_id,provider,whatsapp_phone_number_id,enabled)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','whatsapp','100000000004',false);

INSERT INTO public.business_integrations(business_id,provider,whatsapp_phone_number_id,enabled)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','calendar',NULL,true);

DO $$
DECLARE
  business_a_whatsapp integer;
  business_b_whatsapp integer;
  business_c_whatsapp integer;
  business_a_calendar integer;
BEGIN
  SELECT count(*) INTO business_a_whatsapp
  FROM public.business_integrations
  WHERE business_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND provider='whatsapp';
  SELECT count(*) INTO business_b_whatsapp
  FROM public.business_integrations
  WHERE business_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' AND provider='whatsapp';
  SELECT count(*) INTO business_c_whatsapp
  FROM public.business_integrations
  WHERE business_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' AND provider='whatsapp';
  SELECT count(*) INTO business_a_calendar
  FROM public.business_integrations
  WHERE business_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' AND provider='calendar';

  IF business_a_whatsapp <> 1 OR business_b_whatsapp <> 1 OR business_c_whatsapp <> 1 OR business_a_calendar <> 2 THEN
    RAISE EXCEPTION 'Unexpected WhatsApp/provider integration cardinality: %, %, %, %',
      business_a_whatsapp, business_b_whatsapp, business_c_whatsapp, business_a_calendar;
  END IF;
END
$$;
