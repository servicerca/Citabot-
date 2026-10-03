-- CitaBot: appointment payment preference
-- Applied to production on 2026-10-03.
BEGIN;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS payment_method text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'appointments_payment_method_check'
      AND conrelid = 'public.appointments'::regclass
  ) THEN
    ALTER TABLE public.appointments
      ADD CONSTRAINT appointments_payment_method_check
      CHECK (
        payment_method IS NULL
        OR payment_method IN ('cash','transfer','other')
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.book_appointment_v3(
  p_business_slug text,
  p_service_id uuid,
  p_staff_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text DEFAULT NULL::text,
  p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_customer_notes text DEFAULT NULL::text,
  p_privacy_consent boolean DEFAULT false,
  p_whatsapp_consent boolean DEFAULT false,
  p_payment_method text DEFAULT 'cash'::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_appointment_id uuid;
  v_payment_method text := lower(trim(coalesce(p_payment_method,'cash')));
BEGIN
  IF v_payment_method NOT IN ('cash','transfer','other') THEN
    RAISE EXCEPTION 'Forma de pago no válida';
  END IF;

  v_appointment_id := public.book_appointment_v2(
    p_business_slug,
    p_service_id,
    p_staff_id,
    p_customer_name,
    p_customer_phone,
    p_customer_email,
    p_starts_at,
    p_customer_notes,
    p_privacy_consent,
    p_whatsapp_consent
  );

  UPDATE public.appointments
  SET payment_method = v_payment_method,
      updated_at = now()
  WHERE id = v_appointment_id;

  RETURN v_appointment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.book_appointment_v3(text,uuid,uuid,text,text,text,timestamptz,text,boolean,boolean,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_appointment_v3(text,uuid,uuid,text,text,text,timestamptz,text,boolean,boolean,text)
  TO service_role;

COMMIT;