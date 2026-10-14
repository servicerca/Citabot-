-- The Mercado Pago webhook records confirmed refunds in this table.
-- Allow the refunded terminal state so the webhook can finish its transaction
-- without failing after revenue and entitlement reconciliation has run.
BEGIN;

ALTER TABLE public.directory_boost_orders
  DROP CONSTRAINT IF EXISTS directory_boost_orders_status_check;

ALTER TABLE public.directory_boost_orders
  ADD CONSTRAINT directory_boost_orders_status_check
  CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'expired', 'refunded'));

COMMIT;
