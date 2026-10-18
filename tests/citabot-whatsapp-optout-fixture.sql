-- Minimal disposable schema matching the existing customer and message columns.
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

CREATE TABLE public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  customer_id uuid,
  channel text NOT NULL DEFAULT 'whatsapp',
  direction text NOT NULL,
  body text NOT NULL,
  provider_message_id text,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.customers (business_id, name, phone, phone_normalized)
VALUES (gen_random_uuid(), 'Existing customer fixture', '3000000000', '573000000000');

INSERT INTO public.messages (business_id, customer_id, channel, direction, body, status)
SELECT business_id, id, 'whatsapp', 'inbound', 'Legacy inbound message fixture', 'received'
FROM public.customers
WHERE name = 'Existing customer fixture';
