-- Persist WhatsApp opt-outs separately from reservation-specific contact consent.
-- Adding nullable columns does not alter existing customers or imply marketing opt-in.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp_opted_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_out_source text;

COMMENT ON COLUMN public.customers.whatsapp_opted_out_at IS
  'When the customer asked this business not to send further proactive WhatsApp messages. A non-null value blocks the free-form outbound endpoint.';
COMMENT ON COLUMN public.customers.whatsapp_opt_out_source IS
  'Recorded source of the WhatsApp opt-out; never infer marketing consent from appointment contact consent.';
