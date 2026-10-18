DO $tests$
DECLARE
  v_business uuid := gen_random_uuid();
  v_count integer;
BEGIN
  INSERT INTO public.subscription_change_reconciliation (business_id, new_plan, state, phase)
  VALUES (gen_random_uuid(), 'professional', 'resolved', 'finished');

  INSERT INTO public.subscription_change_reconciliation (business_id, new_plan, state, phase)
  VALUES (gen_random_uuid(), 'premium', 'resolved', 'finished');

  BEGIN
    INSERT INTO public.subscription_change_reconciliation (business_id, new_plan, state, phase)
    VALUES (gen_random_uuid(), 'unsupported', 'resolved', 'finished');
    RAISE EXCEPTION 'Unsupported plan was accepted by the reconciliation constraint';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO public.subscription_change_reconciliation (business_id, new_plan, state, phase)
  VALUES (v_business, 'professional', 'in_progress', 'initiating');

  BEGIN
    INSERT INTO public.subscription_change_reconciliation (business_id, new_plan, state, phase)
    VALUES (v_business, 'premium', 'reconciliation_required', 'initiating');
    RAISE EXCEPTION 'A second unresolved checkout for the same business was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  INSERT INTO public.subscription_change_reconciliation (business_id, new_plan, state, phase)
  VALUES (v_business, 'premium', 'resolved', 'finished');

  SELECT count(*) INTO v_count
  FROM public.subscription_change_reconciliation
  WHERE business_id = v_business;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'Expected one unresolved and one resolved row after tests; found %', v_count;
  END IF;

  IF has_table_privilege('anon', 'public.subscription_change_reconciliation', 'SELECT')
    OR has_table_privilege('anon', 'public.subscription_change_reconciliation', 'INSERT')
    OR has_table_privilege('authenticated', 'public.subscription_change_reconciliation', 'SELECT')
    OR has_table_privilege('authenticated', 'public.subscription_change_reconciliation', 'INSERT') THEN
    RAISE EXCEPTION 'Client roles must not read or write reconciliation records';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.subscription_change_reconciliation', 'SELECT')
    OR NOT has_table_privilege('service_role', 'public.subscription_change_reconciliation', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.subscription_change_reconciliation', 'UPDATE')
    OR NOT has_table_privilege('service_role', 'public.subscription_change_reconciliation', 'DELETE') THEN
    RAISE EXCEPTION 'service_role must retain reconciliation table access';
  END IF;

  RAISE NOTICE 'Professional subscription reconciliation migration: both plans accepted, unsupported plan rejected, one unresolved row per business enforced, client access denied';
END
$tests$;
