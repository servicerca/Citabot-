-- Disposable behavior tests for CitaBot's onboarding RPC and client privilege boundaries.
-- Run after the fixture and the corresponding migrations.
DO $tests$
DECLARE
  v_owner_one constant uuid := '10000000-0000-4000-8000-000000000001';
  v_owner_two constant uuid := '10000000-0000-4000-8000-000000000002';
  v_owner_three constant uuid := '10000000-0000-4000-8000-000000000003';
  v_owner_four constant uuid := '10000000-0000-4000-8000-000000000004';
  v_owner_five constant uuid := '10000000-0000-4000-8000-000000000005';
  v_owner_six constant uuid := '10000000-0000-4000-8000-000000000006';
  v_owner_seven constant uuid := '10000000-0000-4000-8000-000000000007';
  v_platform_admin constant uuid := 'f0000000-0000-4000-8000-000000000001';
  v_owner_value uuid;
  v_expected_slot integer;
  v_pilot_business_id uuid;
  v_pilot_result jsonb;
  v_trial_started timestamptz;
  v_trial_ends timestamptz;
  v_result jsonb;
  v_blocked boolean;
  v_error text;
  v_column text;
BEGIN
  IF NOT has_function_privilege(
    'authenticated',
    'public.create_citabot_business_onboarding(text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated role must be able to execute onboarding';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.create_citabot_business_onboarding(text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anonymous role must not be able to execute onboarding';
  END IF;
  IF has_function_privilege(
    'service_role',
    'public.create_citabot_business_onboarding(text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must not be able to execute owner-bound onboarding';
  END IF;

  -- Authenticated callers may create their first business only through the
  -- atomic RPC; direct table inserts would bypass the one-trial and membership guard.
  IF has_table_privilege('authenticated', 'public.businesses', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated role must not insert businesses directly';
  END IF;
  IF has_table_privilege('authenticated', 'public.business_members', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated role must not insert memberships directly';
  END IF;
  IF has_table_privilege('anon', 'public.businesses', 'INSERT')
     OR has_table_privilege('anon', 'public.business_members', 'INSERT') THEN
    RAISE EXCEPTION 'anonymous role must not insert businesses or memberships';
  END IF;

  -- Business owners may edit only fields exposed by the current workspace form.
  -- Table-level UPDATE would also allow changing status/owner/identity metadata.
  IF has_table_privilege('authenticated', 'public.businesses', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated role must not have table-level UPDATE on businesses';
  END IF;
  IF has_table_privilege('anon', 'public.businesses', 'UPDATE') THEN
    RAISE EXCEPTION 'anonymous role must not have UPDATE on businesses';
  END IF;

  FOREACH v_column IN ARRAY ARRAY[
    'name', 'city', 'address', 'phone', 'whatsapp',
    'is_listed', 'latitude', 'longitude', 'updated_at'
  ] LOOP
    IF NOT has_column_privilege('authenticated', 'public.businesses', v_column, 'UPDATE') THEN
      RAISE EXCEPTION 'authenticated role must be able to update allowed field %', v_column;
    END IF;
  END LOOP;

  FOREACH v_column IN ARRAY ARRAY[
    'id', 'owner_id', 'slug', 'category', 'description', 'email', 'logo_url',
    'timezone', 'is_active', 'created_at'
  ] LOOP
    IF has_column_privilege('authenticated', 'public.businesses', v_column, 'UPDATE') THEN
      RAISE EXCEPTION 'authenticated role must not be able to update protected field %', v_column;
    END IF;
  END LOOP;

  -- An unauthenticated call must be rejected before any business or trial exists.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  v_blocked := false;
  BEGIN
    PERFORM public.create_citabot_business_onboarding(
      'Tienda Central', 'service', 'Santa Marta', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error = 'Sesión requerida' THEN
      v_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'unauthenticated onboarding was not rejected';
  END IF;

  -- First real identity in the disposable database receives exactly one trial.
  PERFORM set_config('request.jwt.claim.sub', v_owner_one::text, true);
  SELECT public.create_citabot_business_onboarding(
    'Tienda Central', 'service', 'Santa Marta', NULL, NULL
  ) INTO v_result;
  IF v_result->'business'->>'slug' <> 'tienda-central' THEN
    RAISE EXCEPTION 'unexpected first slug: %', v_result->'business'->>'slug';
  END IF;
  IF v_result->'trial'->>'plan' <> 'trial'
     OR v_result->'trial'->>'status' <> 'trialing' THEN
    RAISE EXCEPTION 'first onboarding did not produce the expected trial';
  END IF;

  -- A different owner choosing the same public name must receive a unique slug.
  -- This exercises the collision branch that previously called max(integer, integer).
  PERFORM set_config('request.jwt.claim.sub', v_owner_two::text, true);
  SELECT public.create_citabot_business_onboarding(
    'Tienda Central', 'service', 'Santa Marta', NULL, NULL
  ) INTO v_result;
  IF v_result->'business'->>'slug' <> 'tienda-central-2' THEN
    RAISE EXCEPTION 'slug collision did not produce suffix -2: %',
      v_result->'business'->>'slug';
  END IF;

  -- Calling the onboarding RPC again for the first owner cannot mint a second trial.
  PERFORM set_config('request.jwt.claim.sub', v_owner_one::text, true);
  v_blocked := false;
  BEGIN
    PERFORM public.create_citabot_business_onboarding(
      'Otro negocio', 'service', 'Santa Marta', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error LIKE 'Esta cuenta ya tiene un negocio registrado.%' THEN
      v_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'repeat onboarding was not rejected for an existing owner';
  END IF;

  IF (SELECT count(*) FROM public.businesses) <> 2 THEN
    RAISE EXCEPTION 'unexpected business count after guarded onboarding';
  END IF;
  IF (SELECT count(*) FROM public.business_members) <> 2 THEN
    RAISE EXCEPTION 'unexpected membership count after guarded onboarding';
  END IF;
  IF (SELECT count(*) FROM public.subscriptions) <> 2 THEN
    RAISE EXCEPTION 'repeat onboarding created an extra subscription';
  END IF;

  -- Add five additional real-shaped businesses only to this disposable test DB.
  PERFORM set_config('request.jwt.claim.sub', v_owner_three::text, true);
  PERFORM public.create_citabot_business_onboarding('Estudio Norte', 'service', 'Santa Marta', NULL, NULL);
  PERFORM set_config('request.jwt.claim.sub', v_owner_four::text, true);
  PERFORM public.create_citabot_business_onboarding('Barbería Centro', 'service', 'Santa Marta', NULL, NULL);
  PERFORM set_config('request.jwt.claim.sub', v_owner_five::text, true);
  PERFORM public.create_citabot_business_onboarding('Spa Caribe', 'service', 'Santa Marta', NULL, NULL);
  PERFORM set_config('request.jwt.claim.sub', v_owner_six::text, true);
  PERFORM public.create_citabot_business_onboarding('Salón Jardín', 'service', 'Santa Marta', NULL, NULL);
  PERFORM set_config('request.jwt.claim.sub', v_owner_seven::text, true);
  PERFORM public.create_citabot_business_onboarding('Restaurante Parque', 'restaurant', 'Santa Marta', NULL, NULL);

  INSERT INTO public.platform_admins(user_id, is_active)
  VALUES (v_platform_admin, true);

  IF has_function_privilege('anon', 'public.citabot_enroll_30_day_pilot(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.citabot_enroll_30_day_pilot(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client roles must not execute the privileged pilot-enrollment function';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.citabot_enroll_30_day_pilot(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute the server-only pilot-enrollment function';
  END IF;
  IF has_table_privilege('anon', 'public.citabot_pilot_enrollments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.citabot_pilot_enrollments', 'SELECT')
     OR has_table_privilege('anon', 'public.citabot_pilot_enrollments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.citabot_pilot_enrollments', 'INSERT') THEN
    RAISE EXCEPTION 'client roles must not read or write pilot enrollment records directly';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.citabot_pilot_enrollments', 'SELECT') THEN
    RAISE EXCEPTION 'service_role must be able to read pilot records for the protected admin panel';
  END IF;

  -- Business owners cannot allocate a pilot slot themselves.
  SELECT id INTO v_pilot_business_id
  FROM public.businesses WHERE owner_id = v_owner_one;
  v_blocked := false;
  BEGIN
    PERFORM public.citabot_enroll_30_day_pilot(v_pilot_business_id, v_owner_one);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error = 'PILOT_ADMIN_REQUIRED' THEN
      v_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'a non-admin user enrolled a business in the pilot';
  END IF;

  -- Exactly five approved businesses receive 30 days, with stable slot numbers.
  FOR v_owner_value, v_expected_slot IN
    SELECT pilot.owner_id, pilot.slot
    FROM (VALUES
      (v_owner_one, 1),
      (v_owner_two, 2),
      (v_owner_three, 3),
      (v_owner_four, 4),
      (v_owner_five, 5)
    ) AS pilot(owner_id, slot)
    ORDER BY pilot.slot
  LOOP
    SELECT id INTO v_pilot_business_id
    FROM public.businesses WHERE owner_id = v_owner_value;

    SELECT public.citabot_enroll_30_day_pilot(v_pilot_business_id, v_platform_admin)
    INTO v_pilot_result;

    IF (v_pilot_result->>'slot')::integer <> v_expected_slot THEN
      RAISE EXCEPTION 'unexpected pilot slot: expected %, got %', v_expected_slot, v_pilot_result->>'slot';
    END IF;
    IF (v_pilot_result->>'ends_at')::timestamptz -
       (v_pilot_result->>'started_at')::timestamptz <> interval '30 days' THEN
      RAISE EXCEPTION 'pilot slot % did not receive exactly 30 days', v_expected_slot;
    END IF;
  END LOOP;

  SELECT id INTO v_pilot_business_id
  FROM public.businesses WHERE owner_id = v_owner_one;
  SELECT public.citabot_enroll_30_day_pilot(v_pilot_business_id, v_platform_admin)
  INTO v_pilot_result;
  IF coalesce((v_pilot_result->>'already_enrolled')::boolean, false) IS NOT TRUE
     OR (v_pilot_result->>'slot')::integer <> 1 THEN
    RAISE EXCEPTION 'repeating pilot enrollment must return the same slot without consuming another';
  END IF;
  IF (SELECT count(*) FROM public.citabot_pilot_enrollments) <> 5 THEN
    RAISE EXCEPTION 'the pilot cohort must contain exactly five enrollments';
  END IF;

  -- Paid plans are not eligible for a free pilot extension.
  SELECT id INTO v_pilot_business_id
  FROM public.businesses WHERE owner_id = v_owner_six;
  UPDATE public.subscriptions
  SET plan = 'professional', status = 'active'
  WHERE business_id = v_pilot_business_id;
  v_blocked := false;
  BEGIN
    PERFORM public.citabot_enroll_30_day_pilot(v_pilot_business_id, v_platform_admin);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error = 'PILOT_SUBSCRIPTION_NOT_ELIGIBLE' THEN
      v_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'a paid business received the free pilot extension';
  END IF;

  -- The sixth unpaid business is rejected and keeps the ordinary seven-day trial.
  SELECT id INTO v_pilot_business_id
  FROM public.businesses WHERE owner_id = v_owner_seven;
  v_blocked := false;
  BEGIN
    PERFORM public.citabot_enroll_30_day_pilot(v_pilot_business_id, v_platform_admin);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error = 'PILOT_SLOTS_FULL' THEN
      v_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'a sixth business exceeded the five-business pilot cap';
  END IF;
  SELECT trial_started_at, trial_ends_at
  INTO v_trial_started, v_trial_ends
  FROM public.subscriptions WHERE business_id = v_pilot_business_id;
  IF v_trial_ends - v_trial_started <> interval '7 days' THEN
    RAISE EXCEPTION 'a business outside the pilot must retain the standard seven-day trial';
  END IF;

  RAISE NOTICE 'CitaBot integration: secure onboarding and five-slot 30-day pilot, admin-only activation, idempotency, paid-plan exclusion, and seven-day standard trial passed';
END;
$tests$;
