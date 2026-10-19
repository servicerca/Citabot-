-- Use the timestamp assigned by WhatsApp for the inbound message itself.
-- Existing messages intentionally retain NULL; their real provider timestamp cannot be reconstructed safely.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS provider_timestamp timestamptz;

COMMENT ON COLUMN public.messages.provider_timestamp IS
  'Verified timestamp from the WhatsApp Cloud API inbound message payload. Used for the 24-hour free-form service-window decision; never substitute webhook processing time.';

CREATE INDEX IF NOT EXISTS messages_whatsapp_inbound_provider_ts_idx
  ON public.messages (business_id, customer_id, provider_timestamp DESC)
  WHERE channel = 'whatsapp'
    AND direction = 'inbound'
    AND provider_timestamp IS NOT NULL;
