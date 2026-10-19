-- Disposable behavior tests for CitaBot's onboarding RPC and client privilege boundaries.
-- Run after the fixture and the corresponding migrations.
DO $tests$
DECLARE
  v_owner_one constant uuid := '10000000-0000-4000-8000-000000000001';
  v_owner_two constant uuid := '10000000-0000-4000-8000-000000000002';
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

  RAISE NOTICE 'CitaBot integration: onboarding auth, direct-write restriction, field-level business grants, trial limit, and slug collision passed';
END;
$tests$;
