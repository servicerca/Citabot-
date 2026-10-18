DO $tests$
DECLARE
  v_customer public.customers%rowtype;
BEGIN
  SELECT * INTO v_customer FROM public.customers WHERE name = 'Existing customer fixture';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Existing customer fixture was not preserved by migration';
  END IF;
  IF v_customer.whatsapp_opted_out_at IS NOT NULL OR v_customer.whatsapp_opt_out_source IS NOT NULL THEN
    RAISE EXCEPTION 'Existing customers must not be silently opted out or opted in';
  END IF;

  UPDATE public.customers
  SET whatsapp_opted_out_at = now(), whatsapp_opt_out_source = 'inbound_keyword'
  WHERE id = v_customer.id;

  SELECT * INTO v_customer FROM public.customers WHERE id = v_customer.id;
  IF v_customer.whatsapp_opted_out_at IS NULL OR v_customer.whatsapp_opt_out_source <> 'inbound_keyword' THEN
    RAISE EXCEPTION 'The opt-out timestamp and source must persist';
  END IF;
  IF v_customer.phone_normalized <> '573000000000' THEN
    RAISE EXCEPTION 'The migration unexpectedly changed customer identity fields';
  END IF;

  RAISE NOTICE 'WhatsApp opt-out guardrail migration: existing records preserved and explicit opt-out persisted';
END
$tests$;
