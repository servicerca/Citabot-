-- Behavior checks after the trigger-only function privilege migration.
DO $tests$
DECLARE
  v_profile_id uuid := '10000000-0000-4000-8000-000000000031';
  v_role text;
BEGIN
  IF has_function_privilege(
    'anon',
    'public.prevent_profile_role_escalation()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon must not directly execute the trigger-only function';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.prevent_profile_role_escalation()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated must not directly execute the trigger-only function';
  END IF;

  IF has_function_privilege(
    'service_role',
    'public.prevent_profile_role_escalation()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'service_role must not directly execute the trigger-only function';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgname = 'trg_prevent_profile_role_escalation'
      AND t.tgrelid = 'public.profiles'::regclass
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'O'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    WHERE t.tgname = 'trg_prevent_profile_role_escalation'
      AND t.tgrelid = 'public.profiles'::regclass
      AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'profile role protection trigger must remain enabled';
  END IF;

  -- INSERT and UPDATE must still invoke the trigger even though API roles
  -- cannot directly EXECUTE the trigger function.
  INSERT INTO public.profiles (id, role) VALUES (v_profile_id, 'admin');
  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role <> 'client' THEN
    RAISE EXCEPTION 'trigger failed to block role escalation during insert';
  END IF;

  UPDATE public.profiles SET role = 'admin' WHERE id = v_profile_id;
  SELECT role INTO v_role FROM public.profiles WHERE id = v_profile_id;
  IF v_role <> 'client' THEN
    RAISE EXCEPTION 'trigger failed to block role escalation during update';
  END IF;

  RAISE NOTICE 'Trigger privilege test: API execute revoked and profile role trigger still enforces its guard';
END;
$tests$;
