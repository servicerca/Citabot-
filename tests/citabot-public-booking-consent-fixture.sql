\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END
$$;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  timezone text,
  is_active boolean NOT NULL DEFAULT true,
  is_listed boolean NOT NULL DEFAULT true
);
CREATE TABLE public.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  duration_minutes integer NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.business_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  day_of_week integer NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  is_open boolean NOT NULL DEFAULT true,
  opens_at time,
  opening_time time,
  closes_at time,
  closing_time time,
  UNIQUE (business_id, day_of_week)
);
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  name text NOT NULL,
  phone text NOT NULL,
  phone_normalized text GENERATED ALWAYS AS
    (nullif(regexp_replace(trim(coalesce(phone, '')), '[^0-9]', '', 'g'), '')) STORED,
  email text,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, phone_normalized)
);
CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  service_id uuid NOT NULL REFERENCES public.services(id),
  staff_id uuid REFERENCES public.staff(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL,
  customer_notes text,
  privacy_consent_at timestamptz,
  whatsapp_consent_at timestamptz,
  legal_policy_version text,
  payment_method text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.legal_acceptances (
  id bigserial PRIMARY KEY,
  user_id uuid,
  business_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  document text NOT NULL,
  version text NOT NULL,
  context text NOT NULL,
  metadata jsonb NOT NULL
);
