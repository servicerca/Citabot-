\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.book_appointment_v3(
  p_business_slug text,
  p_service_id uuid,
  p_staff_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text DEFAULT NULL,
  p_starts_at timestamptz DEFAULT NULL,
  p_customer_notes text DEFAULT NULL,
  p_privacy_consent boolean DEFAULT false,
  p_whatsapp_consent boolean DEFAULT false,
  p_payment_method text DEFAULT 'cash'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_appointment_id uuid;
  v_payment_method text := lower(trim(coalesce(p_payment_method, 'cash')));
BEGIN
  IF v_payment_method NOT IN ('cash', 'transfer', 'other') THEN
    RAISE EXCEPTION 'Forma de pago no válida';
  END IF;
  v_appointment_id := public.book_appointment_v2(
    p_business_slug, p_service_id, p_staff_id, p_customer_name,
    p_customer_phone, p_customer_email, p_starts_at, p_customer_notes,
    p_privacy_consent, p_whatsapp_consent
  );
  UPDATE public.appointments
  SET payment_method = v_payment_method, updated_at = now()
  WHERE id = v_appointment_id;
  RETURN v_appointment_id;
END;
$function$;

DO $$
DECLARE
  v_business uuid;
  v_service uuid;
  v_without_whatsapp uuid;
  v_with_whatsapp uuid;
  v_privacy_at timestamptz;
  v_whatsapp_at timestamptz;
  v_start timestamptz := date_trunc('day', now()) + interval '2 days 12 hours';
  v_privacy_count integer;
  v_whatsapp_count integer;
BEGIN
  INSERT INTO public.businesses(name, slug, timezone, is_active, is_listed)
  VALUES ('Fixture local', 'fixture-local', 'UTC', true, true)
  RETURNING id INTO v_business;

  INSERT INTO public.services(business_id, duration_minutes, active)
  VALUES (v_business, 30, true)
  RETURNING id INTO v_service;

  INSERT INTO public.business_hours(
    business_id, day_of_week, closed, is_open, opens_at, opening_time, closes_at, closing_time
  )
  SELECT v_business, day_number, false, true, time '00:00', time '00:00', time '23:59', time '23:59'
  FROM generate_series(0, 6) AS day_number;

  -- A customer who accepts privacy but declines WhatsApp must still be able to book.
  v_without_whatsapp := public.book_appointment_v3(
    'fixture-local', v_service, NULL, 'Cliente sin WhatsApp', '3000000001',
    NULL, v_start, NULL, true, false, 'cash'
  );

  SELECT privacy_consent_at, whatsapp_consent_at
  INTO v_privacy_at, v_whatsapp_at
  FROM public.appointments WHERE id = v_without_whatsapp;
  IF v_privacy_at IS NULL THEN RAISE EXCEPTION 'PRIVACY_CONSENT_NOT_RECORDED'; END IF;
  IF v_whatsapp_at IS NOT NULL THEN RAISE EXCEPTION 'WHATSAPP_CONSENT_MUST_REMAIN_NULL'; END IF;

  SELECT count(*) INTO v_privacy_count
  FROM public.legal_acceptances
  WHERE appointment_id = v_without_whatsapp AND document = 'privacy';
  SELECT count(*) INTO v_whatsapp_count
  FROM public.legal_acceptances
  WHERE appointment_id = v_without_whatsapp AND document = 'whatsapp';
  IF v_privacy_count <> 1 THEN RAISE EXCEPTION 'PRIVACY_ACCEPTANCE_MISSING'; END IF;
  IF v_whatsapp_count <> 0 THEN RAISE EXCEPTION 'WHATSAPP_ACCEPTANCE_RECORDED_WITHOUT_OPT_IN'; END IF;

  -- Explicit WhatsApp opt-in is still saved when the customer chooses it.
  v_with_whatsapp := public.book_appointment_v3(
    'fixture-local', v_service, NULL, 'Cliente con WhatsApp', '3000000002',
    NULL, v_start + interval '2 hours', NULL, true, true, 'transfer'
  );
  SELECT privacy_consent_at, whatsapp_consent_at
  INTO v_privacy_at, v_whatsapp_at
  FROM public.appointments WHERE id = v_with_whatsapp;
  IF v_privacy_at IS NULL OR v_whatsapp_at IS NULL THEN
    RAISE EXCEPTION 'EXPLICIT_CONSENT_NOT_RECORDED';
  END IF;
  SELECT count(*) INTO v_whatsapp_count
  FROM public.legal_acceptances
  WHERE appointment_id = v_with_whatsapp AND document = 'whatsapp';
  IF v_whatsapp_count <> 1 THEN RAISE EXCEPTION 'EXPLICIT_WHATSAPP_ACCEPTANCE_MISSING'; END IF;

  -- Privacy remains mandatory, regardless of WhatsApp preference.
  BEGIN
    PERFORM public.book_appointment_v3(
      'fixture-local', v_service, NULL, 'Cliente sin privacidad', '3000000003',
      NULL, v_start + interval '4 hours', NULL, false, false, 'cash'
    );
    RAISE EXCEPTION 'PRIVACY_MUST_BE_REQUIRED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'Debes aceptar la política de privacidad para reservar' THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'OPTIONAL_WHATSAPP_CONSENT_INTEGRATION_OK';
END
$$;
