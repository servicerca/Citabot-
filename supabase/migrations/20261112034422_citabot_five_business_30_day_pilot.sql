-- CitaBot: a manually approved, auditable 30-day pilot limited to five real businesses.
-- Standard public onboarding remains a seven-day trial.
CREATE TABLE public.citabot_pilot_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot smallint NOT NULL UNIQUE CHECK (slot BETWEEN 1 AND 5),
  business_id uuid UNIQUE REFERENCES public.businesses(id) ON DELETE SET NULL,
  business_name_snapshot text NOT NULL,
  owner_user_id uuid NOT NULL,
  enrolled_by uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT citabot_pilot_enrollments_exact_30_days
    CHECK (ends_at = started_at + interval '30 days')
);

ALTER TABLE public.citabot_pilot_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.citabot_pilot_enrollments FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.citabot_pilot_enrollments FROM service_role;
GRANT SELECT ON TABLE public.citabot_pilot_enrollments TO service_role;

CREATE OR REPLACE FUNCTION public.citabot_enroll_30_day_pilot(
  p_business_id uuid,
  p_enrolled_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_name text;
  v_owner_id uuid;
  v_plan text;
  v_status text;
  v_used integer;
  v_max_slot integer;
  v_slot integer;
  v_started_at timestamptz;
  v_ends_at timestamptz;
  v_existing public.citabot_pilot_enrollments%rowtype;
BEGIN
  IF p_business_id IS NULL OR p_enrolled_by IS NULL THEN
    RAISE EXCEPTION 'PILOT_INVALID_INPUT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = p_enrolled_by
      AND pa.is_active = true
  ) THEN
    RAISE EXCEPTION 'PILOT_ADMIN_REQUIRED';
  END IF;

  -- Serialize all enrolments so concurrent admins cannot exceed five slots.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('citabot-five-business-30-day-pilot', 0)
  );

  SELECT pe.*
  INTO v_existing
  FROM public.citabot_pilot_enrollments pe
  WHERE pe.business_id = p_business_id;

  IF FOUND THEN
    SELECT count(*)::integer
    INTO v_used
    FROM public.citabot_pilot_enrollments;

    RETURN jsonb_build_object(
      'already_enrolled', true,
      'slot', v_existing.slot,
      'business_id', v_existing.business_id,
      'business_name', v_existing.business_name_snapshot,
      'owner_user_id', v_existing.owner_user_id,
      'started_at', v_existing.started_at,
      'ends_at', v_existing.ends_at,
      'slots_used', v_used,
      'slots_total', 5,
      'slots_remaining', greatest(0, 5 - v_used)
    );
  END IF;

  SELECT b.name, b.owner_id
  INTO v_name, v_owner_id
  FROM public.businesses b
  WHERE b.id = p_business_id
    AND b.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PILOT_BUSINESS_NOT_FOUND_OR_INACTIVE';
  END IF;

  SELECT s.plan, s.status
  INTO v_plan, v_status
  FROM public.subscriptions s
  WHERE s.business_id = p_business_id;

  IF NOT FOUND
     OR v_plan NOT IN ('free', 'trial')
     OR v_status NOT IN ('active', 'trialing') THEN
    RAISE EXCEPTION 'PILOT_SUBSCRIPTION_NOT_ELIGIBLE';
  END IF;

  SELECT count(*)::integer, coalesce(max(pe.slot), 0)::integer
  INTO v_used, v_max_slot
  FROM public.citabot_pilot_enrollments pe;

  IF v_used >= 5 THEN
    RAISE EXCEPTION 'PILOT_SLOTS_FULL';
  END IF;

  v_slot := v_max_slot + 1;
  v_started_at := now();
  v_ends_at := v_started_at + interval '30 days';

  UPDATE public.subscriptions
  SET plan = 'trial',
      status = 'trialing',
      trial_started_at = v_started_at,
      trial_ends_at = v_ends_at,
      updated_at = v_started_at
  WHERE business_id = p_business_id;

  INSERT INTO public.citabot_pilot_enrollments (
    slot,
    business_id,
    business_name_snapshot,
    owner_user_id,
    enrolled_by,
    started_at,
    ends_at
  )
  VALUES (
    v_slot,
    p_business_id,
    v_name,
    v_owner_id,
    p_enrolled_by,
    v_started_at,
    v_ends_at
  );

  RETURN jsonb_build_object(
    'already_enrolled', false,
    'slot', v_slot,
    'business_id', p_business_id,
    'business_name', v_name,
    'owner_user_id', v_owner_id,
    'started_at', v_started_at,
    'ends_at', v_ends_at,
    'slots_used', v_used + 1,
    'slots_total', 5,
    'slots_remaining', greatest(0, 4 - v_used)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.citabot_enroll_30_day_pilot(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.citabot_enroll_30_day_pilot(uuid, uuid)
  TO service_role;
