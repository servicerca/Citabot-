\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END
$$;
CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

CREATE TABLE public.public_booking_rate_limits (
  rate_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  hits integer NOT NULL,
  updated_at timestamptz NOT NULL
);

-- Disposable fixture of the production single-key primitive used by the
-- atomic wrapper migration. This is test-only and is never applied to prod.
CREATE OR REPLACE FUNCTION public.consume_public_booking_rate_limit(
  p_rate_key text,
  p_limit integer DEFAULT 20,
  p_window_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_row public.public_booking_rate_limits%rowtype;
BEGIN
  IF p_rate_key IS NULL OR length(trim(p_rate_key)) < 8 THEN
    RAISE EXCEPTION 'Rate key inválida';
  END IF;
  IF p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Rate limit inválido';
  END IF;

  INSERT INTO public.public_booking_rate_limits(rate_key, window_started_at, hits, updated_at)
  VALUES (p_rate_key, v_now, 1, v_now)
  ON CONFLICT (rate_key) DO UPDATE
    SET window_started_at = CASE
          WHEN public.public_booking_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
          THEN v_now ELSE public.public_booking_rate_limits.window_started_at END,
        hits = CASE
          WHEN public.public_booking_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
          THEN 1 ELSE public.public_booking_rate_limits.hits + 1 END,
        updated_at = v_now;

  SELECT * INTO v_row FROM public.public_booking_rate_limits WHERE rate_key = p_rate_key;
  DELETE FROM public.public_booking_rate_limits
   WHERE updated_at < v_now - interval '2 days';
  RETURN v_row.hits <= p_limit;
END;
$function$;
