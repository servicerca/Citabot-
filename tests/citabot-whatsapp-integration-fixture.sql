CREATE TABLE public.business_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  provider text NOT NULL,
  whatsapp_phone_number_id text,
  enabled boolean NOT NULL DEFAULT false
);

-- A phone ID is already unique across WhatsApp integrations.
CREATE UNIQUE INDEX business_integrations_provider_whatsapp_phone_number_id_key
ON public.business_integrations (provider, whatsapp_phone_number_id);

INSERT INTO public.business_integrations(business_id,provider,whatsapp_phone_number_id,enabled) VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','whatsapp','100000000001',false),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','whatsapp','100000000002',true),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','calendar',NULL,true);
