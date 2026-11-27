DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

CREATE TABLE public.business_members (
  business_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  PRIMARY KEY (business_id, user_id)
);

CREATE TABLE public.legal_acceptances (
  id uuid PRIMARY KEY,
  user_id uuid,
  business_id uuid,
  appointment_id uuid,
  document text NOT NULL CHECK (document IN ('terms','privacy','whatsapp')),
  version text NOT NULL,
  context text NOT NULL DEFAULT 'app',
  accepted_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.business_members TO authenticated;
GRANT SELECT ON public.legal_acceptances TO authenticated;

-- Reproduce the two legacy permissive policies that the migration must consolidate.
CREATE POLICY legal_acceptances_business_marketing_select
ON public.legal_acceptances
FOR SELECT
TO authenticated
USING (
  document = 'whatsapp'
  AND context = 'public_booking_marketing'
  AND metadata ->> 'purpose' = 'marketing'
  AND EXISTS (
    SELECT 1
    FROM public.business_members AS bm
    WHERE bm.business_id = legal_acceptances.business_id
      AND bm.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY legal_acceptances_select_own
ON public.legal_acceptances
FOR SELECT
TO authenticated
USING ((SELECT auth.uid()) = user_id);

INSERT INTO public.business_members(business_id,user_id,role) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','owner'),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','owner'),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','staff');

INSERT INTO public.legal_acceptances(id,business_id,document,version,context,metadata) VALUES
('00000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','whatsapp','marketing-v1','public_booking_marketing','{"purpose":"marketing","customer_id":"customer-a"}'),
('00000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','whatsapp','booking-v1','public_booking','{"consent":"reservation_contact"}'),
('00000000-0000-4000-8000-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','whatsapp','marketing-v1','public_booking_marketing','{"purpose":"marketing","customer_id":"customer-b"}'),
('00000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','whatsapp','other-v1','public_booking_marketing','{"purpose":"service","customer_id":"customer-c"}'),
('00000000-0000-4000-8000-000000000005',NULL,'privacy','signup-v1','signup','{"source":"owner-account"}');
