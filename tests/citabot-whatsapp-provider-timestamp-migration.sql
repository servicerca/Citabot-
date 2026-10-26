DO $tests$
DECLARE
  v_message public.messages%rowtype;
  v_provider_at timestamptz := '2026-10-18 10:15:00+00'::timestamptz;
BEGIN
  SELECT * INTO v_message
  FROM public.messages
  WHERE body = 'Legacy inbound message fixture'
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Legacy message disappeared during migration';
  END IF;
  IF v_message.provider_timestamp IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy messages must remain NULL until their actual provider timestamp is available';
  END IF;

  UPDATE public.messages
  SET provider_timestamp = v_provider_at
  WHERE id = v_message.id;

  SELECT * INTO v_message FROM public.messages WHERE id = v_message.id;
  IF v_message.provider_timestamp IS DISTINCT FROM v_provider_at THEN
    RAISE EXCEPTION 'Provider timestamp was not persisted accurately';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'messages'
      AND indexname = 'messages_whatsapp_inbound_provider_ts_idx'
  ) THEN
    RAISE EXCEPTION 'The provider timestamp lookup index is missing';
  END IF;

  RAISE NOTICE 'WhatsApp provider timestamp migration: preserves legacy rows, stores provider timestamp, and creates indexed lookup';
END;
$tests$;
