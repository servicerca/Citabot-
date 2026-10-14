DO $tests$
DECLARE
  v_status text;
  v_count integer;
BEGIN
  FOREACH v_status IN ARRAY ARRAY['pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded'] LOOP
    INSERT INTO public.directory_boost_orders (id, business_id, amount, currency, status)
    VALUES (gen_random_uuid(), gen_random_uuid(), 5000, 'COP', v_status);
  END LOOP;

  SELECT count(*) INTO v_count
  FROM public.directory_boost_orders
  WHERE status IN ('pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded');
  IF v_count <> 6 THEN
    RAISE EXCEPTION 'Expected all six documented boost order statuses, found %', v_count;
  END IF;

  BEGIN
    INSERT INTO public.directory_boost_orders (id, business_id, amount, currency, status)
    VALUES (gen_random_uuid(), gen_random_uuid(), 5000, 'COP', 'unknown');
    RAISE EXCEPTION 'Unexpected status was accepted by the constraint';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  RAISE NOTICE 'CitaBot boost order status migration: pending/paid/failed/cancelled/expired/refunded accepted; unknown rejected';
END
$tests$;
