-- Disposable CI fixture representing the currently deployed reconciliation table.
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END;
$roles$;

CREATE TABLE public.subscription_change_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'mercadopago' CHECK (provider = 'mercadopago'),
  previous_plan text,
  previous_subscription_id text,
  new_plan text NOT NULL CONSTRAINT subscription_change_reconciliation_new_plan_check CHECK (new_plan = 'premium'),
  new_subscription_id text,
  previous_subscription jsonb,
  state text NOT NULL DEFAULT 'in_progress'
    CHECK (state IN ('in_progress', 'resolved', 'reconciliation_required')),
  phase text NOT NULL CONSTRAINT subscription_change_reconciliation_phase_check
    CHECK (phase IN ('initiating', 'provider_created', 'local_pending_saved', 'old_subscription_cancelled',
      'rollback_started', 'rolled_back', 'local_restore_failed', 'rollback_unconfirmed', 'finished')),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX subscription_change_reconciliation_one_unresolved_per_business_idx
  ON public.subscription_change_reconciliation (business_id)
  WHERE state IN ('in_progress', 'reconciliation_required');

ALTER TABLE public.subscription_change_reconciliation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subscription_change_reconciliation FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.subscription_change_reconciliation TO service_role;
