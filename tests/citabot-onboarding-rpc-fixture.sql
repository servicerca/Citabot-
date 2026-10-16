-- Disposable PostgreSQL fixture for CitaBot onboarding RPC integration tests.
-- This file is used only by CI's temporary PostgreSQL service, never production.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;

CREATE SCHEMA auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;

CREATE TABLE public.businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  slug text,
  category text NOT NULL,
  city text,
  address text,
  latitude numeric,
  longitude numeric,
  phone text,
  whatsapp text,
  timezone text NOT NULL DEFAULT 'America/Bogota',
  is_active boolean NOT NULL DEFAULT true,
  is_listed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);
CREATE UNIQUE INDEX businesses_slug_unique_idx
  ON public.businesses (slug)
  WHERE slug IS NOT NULL AND length(trim(slug)) > 0;

CREATE TABLE public.business_members (
  business_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, user_id)
);

CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'trial',
  status text NOT NULL DEFAULT 'trialing',
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Simulate the broad authenticated INSERT grants observed in production before
-- the direct-write hardening migration is applied by CI.
GRANT INSERT ON TABLE public.businesses TO authenticated;
GRANT INSERT ON TABLE public.business_members TO authenticated;
