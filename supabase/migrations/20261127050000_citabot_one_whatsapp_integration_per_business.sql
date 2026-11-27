-- A business has one WhatsApp Cloud API connection in the current product model.
-- Different businesses may use different phone numbers; other providers remain unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS business_integrations_one_whatsapp_per_business
ON public.business_integrations (business_id)
WHERE provider = 'whatsapp';
