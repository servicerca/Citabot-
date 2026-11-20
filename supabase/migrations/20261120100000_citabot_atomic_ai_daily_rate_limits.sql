-- Atomically reserve all daily AI rate-limit buckets in one transaction.
-- If any bucket rejects the request, the exception rolls back every earlier bucket update.
CREATE OR REPLACE FUNCTION public.reserve_citabot_ai_daily_rate_limits(
  p_rate_keys text[],
  p_limits integer[],
  p_window_seconds integer[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_count integer;
  v_unique_count integer;
  v_bucket record;
  v_allowed boolean;
  v_rejected boolean := false;
BEGIN
  IF p_rate_keys IS NULL OR p_limits IS NULL OR p_window_seconds IS NULL THEN
    RAISE EXCEPTION 'CITABOT_AI_RATE_LIMIT_ARGUMENTS_INVALID' USING ERRCODE = '22023';
  END IF;

  v_count := cardinality(p_rate_keys);
  IF v_count < 1 OR v_count > 3
     OR cardinality(p_limits) <> v_count
     OR cardinality(p_window_seconds) <> v_count THEN
    RAISE EXCEPTION 'CITABOT_AI_RATE_LIMIT_ARGUMENTS_INVALID' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM generate_subscripts(p_rate_keys, 1) AS s(i)
    WHERE p_rate_keys[s.i] IS NULL OR length(trim(p_rate_keys[s.i])) < 8
       OR p_limits[s.i] IS NULL OR p_limits[s.i] < 1
       OR p_window_seconds[s.i] IS NULL OR p_window_seconds[s.i] < 1
  ) THEN
    RAISE EXCEPTION 'CITABOT_AI_RATE_LIMIT_ARGUMENTS_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT rate_key)
  INTO v_unique_count
  FROM unnest(p_rate_keys) AS keys(rate_key);

  IF v_unique_count <> v_count THEN
    RAISE EXCEPTION 'CITABOT_AI_RATE_LIMIT_KEYS_MUST_BE_UNIQUE' USING ERRCODE = '22023';
  END IF;

  -- A deterministic lock/update order reduces deadlock risk when requests
  -- reserve overlapping user, business and platform buckets concurrently.
  FOR v_bucket IN
    SELECT
      p_rate_keys[s.i] AS rate_key,
      p_limits[s.i] AS rate_limit,
      p_window_seconds[s.i] AS window_seconds
    FROM generate_subscripts(p_rate_keys, 1) AS s(i)
    ORDER BY p_rate_keys[s.i]
  LOOP
    v_allowed := public.consume_public_booking_rate_limit(
      v_bucket.rate_key,
      v_bucket.rate_limit,
      v_bucket.window_seconds
    );
    IF v_allowed IS DISTINCT FROM true THEN
      v_rejected := true;
    END IF;
  END LOOP;

  IF v_rejected THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'CITABOT_AI_RATE_LIMIT_REACHED';
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_citabot_ai_daily_rate_limits(text[],integer[],integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_citabot_ai_daily_rate_limits(text[],integer[],integer[]) TO service_role;
