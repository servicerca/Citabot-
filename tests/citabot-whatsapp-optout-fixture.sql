-- Minimal disposable schema matching the existing customer columns used by CitaBot.
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  phone_normalized text
);
INSERT INTO public.customers (business_id, name, phone, phone_normalized)
VALUES (gen_random_uuid(), 'Existing customer fixture', '3000000000', '573000000000');
