-- CitaBot: prevent duplicate trial onboarding and make slug collisions deterministic.
-- A signed-in owner may create their first business through this RPC only.
-- Creating additional businesses needs a dedicated, plan-aware flow; this RPC is onboarding.
-- Advisory transaction locks serialize onboarding per user and allocation of a public slug.
CREATE OR REPLACE FUNCTION public.create_citabot_business_onboarding(
  p_name text,
  p_category text,
  p_city text DEFAULT NULL::text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_category text := lower(trim(coalesce(p_category, 'service')));
  v_city text := nullif(trim(coalesce(p_city, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_email text := nullif(trim(coalesce(p_email, '')), '');
  v_slug text;
  v_base_slug text;
  v_suffix integer := 1;
  v_business public.businesses%rowtype;
  v_trial_started timestamptz := now();
  v_trial_ends timestamptz := now() + interval '7 days';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sesión requerida';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'El nombre del negocio es obligatorio';
  END IF;
  IF length(v_name) > 120 THEN
    RAISE EXCEPTION 'El nombre del negocio es demasiado largo';
  END IF;
  IF v_category NOT IN ('service', 'restaurant') THEN
    RAISE EXCEPTION 'Categoría no válida';
  END IF;
  IF v_city IS NOT NULL AND length(v_city) > 120 THEN
    RAISE EXCEPTION 'La ciudad es demasiado larga';
  END IF;
  IF v_phone IS NOT NULL AND length(v_phone) > 40 THEN
    RAISE EXCEPTION 'El WhatsApp es demasiado largo';
  END IF;
  IF v_email IS NOT NULL AND length(v_email) > 160 THEN
    RAISE EXCEPTION 'El correo es demasiado largo';
  END IF;

  -- Prevent parallel requests from racing through the same user's first-trial check.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('citabot-user-onboarding:' || v_user_id::text, 0)
  );

  -- The onboarding RPC is not an "add business" endpoint. Do not create extra
  -- trial subscriptions by calling the public RPC repeatedly for the same owner.
  IF EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Esta cuenta ya tiene un negocio registrado. Inicia sesión para continuar o solicita ayuda para recuperar el acceso.';
  END IF;

  v_base_slug := lower(
    regexp_replace(
      regexp_replace(v_name, '[^[:alnum:][:space:]-]', '', 'g'),
      '[[:space:]-]+', '-', 'g'
    )
  );
  v_base_slug := trim(both '-' FROM v_base_slug);
  IF v_base_slug = '' THEN
    v_base_slug := 'negocio';
  END IF;
  v_base_slug := left(v_base_slug, 60);
  v_slug := v_base_slug;

  -- Serialize slug allocation across different owners too. This avoids two
  -- simultaneous signups both selecting the same free slug.
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('citabot-business-slug:' || v_slug, 0)
    );
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.businesses b WHERE b.slug = v_slug
    );

    v_suffix := v_suffix + 1;
    -- GREATEST is the scalar function; max() is an aggregate and fails here.
    v_slug := left(v_base_slug, greatest(1, 60 - length(v_suffix::text) - 1))
      || '-' || v_suffix::text;
  END LOOP;

  INSERT INTO public.businesses(
    owner_id, name, slug, category, city, phone, whatsapp,
    timezone, is_active, is_listed
  )
  VALUES (
    v_user_id, v_name, v_slug, v_category, v_city, v_phone, v_phone,
    'America/Bogota', true, false
  )
  RETURNING * INTO v_business;

  INSERT INTO public.business_members(business_id, user_id, role)
  VALUES (v_business.id, v_user_id, 'owner');

  INSERT INTO public.subscriptions(
    business_id, plan, status, trial_started_at, trial_ends_at, provider
  )
  VALUES (
    v_business.id, 'trial', 'trialing', v_trial_started, v_trial_ends, 'citabot'
  );

  RETURN jsonb_build_object(
    'business', to_jsonb(v_business),
    'trial', jsonb_build_object(
      'plan', 'trial',
      'status', 'trialing',
      'trial_started_at', v_trial_started,
      'trial_ends_at', v_trial_ends
    )
  );
END;
$function$;

-- Preserve the hardened, signed-in-only RPC surface.
REVOKE ALL ON FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_citabot_business_onboarding(text, text, text, text, text)
  TO authenticated;
