-- The same per-business unresolved-checkout lock must protect both plan tiers.
-- Existing records remain Premium; the wider CHECK only enables the Professional flow.
ALTER TABLE public.subscription_change_reconciliation
  DROP CONSTRAINT IF EXISTS subscription_change_reconciliation_new_plan_check;

ALTER TABLE public.subscription_change_reconciliation
  ADD CONSTRAINT subscription_change_reconciliation_new_plan_check
  CHECK (new_plan IN ('premium', 'professional'));
