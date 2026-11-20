\set ON_ERROR_STOP on
DO $$
DECLARE
  v_business uuid := gen_random_uuid();
  v_second_business uuid := gen_random_uuid();
  v_result jsonb;
  v_used integer;
  v_input_tokens bigint;
  v_output_tokens bigint;
BEGIN
  INSERT INTO public.businesses(id, name) VALUES (v_business, 'AI quota fixture');

  v_result := public.reserve_citabot_ai_request(v_business, 'professional', 100, 100);
  IF v_result->>'allowed' <> 'false' OR v_result->>'reason' <> 'not_configured' THEN
    RAISE EXCEPTION 'AI_QUOTA_MUST_FAIL_CLOSED_BY_DEFAULT: %', v_result;
  END IF;

  UPDATE public.citabot_ai_plan_limits
  SET enabled = true, monthly_request_limit = 2
  WHERE plan = 'professional';

  v_result := public.reserve_citabot_ai_request(v_business, 'professional', 100, 100);
  IF v_result->>'allowed' <> 'false' OR v_result->>'reason' <> 'global_not_configured' THEN
    RAISE EXCEPTION 'GLOBAL_AI_QUOTA_MUST_FAIL_CLOSED_BY_DEFAULT: %', v_result;
  END IF;

  UPDATE public.citabot_ai_global_limit
  SET enabled = true, monthly_request_limit = 3
  WHERE singleton = true;

  v_result := public.reserve_citabot_ai_request(v_business, 'professional', 100, 100);
  IF v_result->>'allowed' <> 'true' OR (v_result->>'remaining')::integer <> 1 THEN
    RAISE EXCEPTION 'FIRST_AI_REQUEST_NOT_RESERVED: %', v_result;
  END IF;

  v_result := public.reserve_citabot_ai_request(v_business, 'professional', 100, 100);
  IF v_result->>'allowed' <> 'true' OR (v_result->>'remaining')::integer <> 0 THEN
    RAISE EXCEPTION 'SECOND_AI_REQUEST_NOT_RESERVED: %', v_result;
  END IF;

  v_result := public.reserve_citabot_ai_request(v_business, 'professional', 100, 100);
  IF v_result->>'allowed' <> 'false' OR v_result->>'reason' <> 'monthly_limit' THEN
    RAISE EXCEPTION 'MONTHLY_AI_LIMIT_NOT_ENFORCED: %', v_result;
  END IF;

  UPDATE public.citabot_ai_plan_limits
  SET monthly_request_limit = 10
  WHERE plan = 'professional';
  INSERT INTO public.businesses(id, name)
  VALUES (v_second_business, 'Second AI quota fixture');

  v_result := public.reserve_citabot_ai_request(v_second_business, 'professional', 100, 100);
  IF v_result->>'allowed' <> 'true' OR (v_result->>'global_remaining')::integer <> 0 THEN
    RAISE EXCEPTION 'GLOBAL_AI_LIMIT_THIRD_REQUEST_NOT_RESERVED: %', v_result;
  END IF;

  v_result := public.reserve_citabot_ai_request(v_second_business, 'professional', 100, 100);
  IF v_result->>'allowed' <> 'false' OR v_result->>'reason' <> 'global_monthly_limit' THEN
    RAISE EXCEPTION 'GLOBAL_AI_MONTHLY_LIMIT_NOT_ENFORCED: %', v_result;
  END IF;

  v_result := public.reserve_citabot_ai_request(v_business, 'professional', 6001, 100);
  IF v_result->>'allowed' <> 'false' OR v_result->>'reason' <> 'input_limit' THEN
    RAISE EXCEPTION 'INPUT_LIMIT_NOT_ENFORCED: %', v_result;
  END IF;

  PERFORM public.record_citabot_ai_usage(v_business, 123, 45);
  SELECT requests_reserved, input_tokens, output_tokens
  INTO v_used, v_input_tokens, v_output_tokens
  FROM public.citabot_ai_usage
  WHERE business_id = v_business
    AND usage_month = date_trunc('month', now() AT TIME ZONE 'UTC')::date;

  IF v_used <> 2 OR v_input_tokens <> 123 OR v_output_tokens <> 45 THEN
    RAISE EXCEPTION 'AI_USAGE_LEDGER_INCORRECT: requests %, input %, output %', v_used, v_input_tokens, v_output_tokens;
  END IF;

  IF (SELECT requests_reserved FROM public.citabot_ai_global_usage
      WHERE usage_month = date_trunc('month', now() AT TIME ZONE 'UTC')::date) <> 3 THEN
    RAISE EXCEPTION 'GLOBAL_AI_USAGE_LEDGER_INCORRECT';
  END IF;

  IF has_function_privilege('anon', 'public.reserve_citabot_ai_request(uuid,text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reserve_citabot_ai_request(uuid,text,integer,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.record_citabot_ai_usage(uuid,bigint,bigint)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_citabot_ai_usage(uuid,bigint,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'AI_QUOTA_RPC_MUST_NOT_BE_CLIENT_EXECUTABLE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.reserve_citabot_ai_request(uuid,text,integer,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.record_citabot_ai_usage(uuid,bigint,bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'SERVICE_ROLE_AI_QUOTA_EXECUTE_REQUIRED';
  END IF;

  RAISE NOTICE 'AI_QUOTA_HARD_STOP_INTEGRATION_OK';
END
$$;


-- Multi-bucket daily AI reservations are all-or-nothing.
DO $$
DECLARE
  v_allowed boolean;
  v_blocked boolean := false;
  v_user_hits integer;
  v_platform_hits integer;
  v_business_hits integer;
BEGIN
  v_allowed := public.reserve_citabot_ai_daily_rate_limits(
    ARRAY['ai:user:atomic-success', 'ai:platform:atomic-success', 'ai:business:atomic-success'],
    ARRAY[6, 100, 25],
    ARRAY[300, 86400, 86400]
  );
  IF v_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ATOMIC_DAILY_LIMIT_SUCCESS_CASE_REJECTED';
  END IF;

  IF (SELECT count(*) FROM public.public_booking_rate_limits
      WHERE rate_key IN ('ai:user:atomic-success', 'ai:platform:atomic-success', 'ai:business:atomic-success')
        AND hits = 1) <> 3 THEN
    RAISE EXCEPTION 'ATOMIC_DAILY_LIMIT_SUCCESS_DID_NOT_RESERVE_ALL_BUCKETS';
  END IF;

  INSERT INTO public.public_booking_rate_limits(rate_key, window_started_at, hits, updated_at)
  VALUES ('ai:02:platform-blocked', now(), 1, now());

  BEGIN
    PERFORM public.reserve_citabot_ai_daily_rate_limits(
      ARRAY['ai:01:user-new', 'ai:02:platform-blocked', 'ai:03:business-new'],
      ARRAY[6, 100, 25],
      ARRAY[300, 86400, 86400]
    );
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := SQLERRM = 'CITABOT_AI_RATE_LIMIT_REACHED';
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'ATOMIC_DAILY_LIMIT_DID_NOT_REJECT_EXHAUSTED_BUCKET';
  END IF;

  SELECT count(*) INTO v_user_hits
  FROM public.public_booking_rate_limits
  WHERE rate_key = 'ai:01:user-new';
  SELECT hits INTO v_platform_hits
  FROM public.public_booking_rate_limits
  WHERE rate_key = 'ai:02:platform-blocked';
  SELECT count(*) INTO v_business_hits
  FROM public.public_booking_rate_limits
  WHERE rate_key = 'ai:03:business-new';

  IF v_user_hits <> 0 OR v_business_hits <> 0 OR v_platform_hits <> 1 THEN
    RAISE EXCEPTION 'ATOMIC_DAILY_LIMIT_PARTIAL_UPDATES_NOT_ROLLED_BACK: user %, platform %, business %',
      v_user_hits, v_platform_hits, v_business_hits;
  END IF;

  IF has_function_privilege('anon', 'public.reserve_citabot_ai_daily_rate_limits(text[],integer[],integer[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.reserve_citabot_ai_daily_rate_limits(text[],integer[],integer[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'ATOMIC_DAILY_LIMIT_RPC_MUST_NOT_BE_CLIENT_EXECUTABLE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.reserve_citabot_ai_daily_rate_limits(text[],integer[],integer[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'SERVICE_ROLE_ATOMIC_DAILY_LIMIT_EXECUTE_REQUIRED';
  END IF;

  RAISE NOTICE 'ATOMIC_DAILY_AI_RATE_LIMITS_INTEGRATION_OK';
END
$$;
