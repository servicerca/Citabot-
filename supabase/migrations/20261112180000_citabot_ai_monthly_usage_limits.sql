-- Server-side CitaBot AI quota guard.
-- New plans are disabled until an administrator explicitly configures a safe monthly limit.
CREATE TABLE IF NOT EXISTS public.citabot_ai_plan_limits (
  plan text PRIMARY KEY CHECK (plan IN ('trial', 'professional', 'premium')),
  enabled boolean NOT NULL DEFAULT false,
  monthly_request_limit integer NOT NULL DEFAULT 0 CHECK (monthly_request_limit >= 0),
  max_input_chars integer NOT NULL DEFAULT 6000 CHECK (max_input_chars BETWEEN 1 AND 6000),
  max_context_chars integer NOT NULL DEFAULT 12000 CHECK (max_context_chars BETWEEN 0 AND 12000),
  max_output_tokens integer NOT NULL DEFAULT 300 CHECK (max_output_tokens BETWEEN 1 AND 300),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.citabot_ai_usage (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  usage_month date NOT NULL,
  requests_reserved integer NOT NULL DEFAULT 0 CHECK (requests_reserved >= 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, usage_month)
);

ALTER TABLE public.citabot_ai_plan_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.citabot_ai_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.citabot_ai_plan_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.citabot_ai_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.citabot_ai_plan_limits TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.citabot_ai_usage TO service_role;

INSERT INTO public.citabot_ai_plan_limits
  (plan, enabled, monthly_request_limit, max_input_chars, max_context_chars, max_output_tokens)
VALUES
  ('trial', false, 0, 6000, 12000, 300),
  ('professional', false, 0, 6000, 12000, 300),
  ('premium', false, 0, 6000, 12000, 300)
ON CONFLICT (plan) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reserve_citabot_ai_request(
  p_business_id uuid,
  p_plan text,
  p_input_chars integer,
  p_context_chars integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit public.citabot_ai_plan_limits%rowtype;
  v_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  v_used integer;
BEGIN
  IF p_business_id IS NULL OR p_plan NOT IN ('trial', 'professional', 'premium')
     OR p_input_chars IS NULL OR p_context_chars IS NULL
     OR p_input_chars < 1 OR p_context_chars < 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_request');
  END IF;

  SELECT * INTO v_limit
  FROM public.citabot_ai_plan_limits
  WHERE plan = p_plan;

  IF NOT FOUND OR NOT v_limit.enabled OR v_limit.monthly_request_limit <= 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'not_configured');
  END IF;

  IF p_input_chars > v_limit.max_input_chars OR p_context_chars > v_limit.max_context_chars THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'input_limit');
  END IF;

  INSERT INTO public.citabot_ai_usage(business_id, usage_month, requests_reserved, updated_at)
  VALUES (p_business_id, v_month, 1, now())
  ON CONFLICT (business_id, usage_month)
  DO UPDATE SET
    requests_reserved = public.citabot_ai_usage.requests_reserved + 1,
    updated_at = now()
  WHERE public.citabot_ai_usage.requests_reserved < v_limit.monthly_request_limit
  RETURNING requests_reserved INTO v_used;

  IF NOT FOUND THEN
    SELECT requests_reserved INTO v_used
    FROM public.citabot_ai_usage
    WHERE business_id = p_business_id AND usage_month = v_month;
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_limit',
      'used', coalesce(v_used, v_limit.monthly_request_limit),
      'limit', v_limit.monthly_request_limit,
      'remaining', 0
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'limit', v_limit.monthly_request_limit,
    'remaining', greatest(v_limit.monthly_request_limit - v_used, 0),
    'usage_month', v_month,
    'max_output_tokens', v_limit.max_output_tokens
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_citabot_ai_usage(
  p_business_id uuid,
  p_input_tokens bigint DEFAULT 0,
  p_output_tokens bigint DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF p_business_id IS NULL OR coalesce(p_input_tokens, 0) < 0 OR coalesce(p_output_tokens, 0) < 0 THEN
    RETURN false;
  END IF;

  UPDATE public.citabot_ai_usage
  SET input_tokens = input_tokens + coalesce(p_input_tokens, 0),
      output_tokens = output_tokens + coalesce(p_output_tokens, 0),
      updated_at = now()
  WHERE business_id = p_business_id AND usage_month = v_month;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_citabot_ai_request(uuid,text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_citabot_ai_usage(uuid,bigint,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_citabot_ai_request(uuid,text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_citabot_ai_usage(uuid,bigint,bigint) TO service_role;
