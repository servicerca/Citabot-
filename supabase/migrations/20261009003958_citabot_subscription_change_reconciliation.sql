-- Durable, server-only recovery records for subscription-provider changes.
-- This table stores provider IDs and a prior subscriptions-row snapshot so a failed
-- cross-system checkout transition can be reconciled without making duplicate charges.
create table if not exists public.subscription_change_reconciliation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  provider text not null default 'mercadopago' check (provider = 'mercadopago'),
  previous_plan text,
  previous_subscription_id text,
  new_plan text not null check (new_plan = 'premium'),
  new_subscription_id text not null,
  previous_subscription jsonb,
  state text not null default 'in_progress'
    check (state in ('in_progress', 'resolved', 'reconciliation_required')),
  phase text not null
    check (phase in (
      'provider_created',
      'local_pending_saved',
      'old_subscription_cancelled',
      'rollback_started',
      'rolled_back',
      'local_restore_failed',
      'rollback_unconfirmed',
      'finished'
    )),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists subscription_change_reconciliation_business_state_idx
  on public.subscription_change_reconciliation (business_id, state, created_at desc);

alter table public.subscription_change_reconciliation enable row level security;
revoke all on table public.subscription_change_reconciliation from public, anon, authenticated;
grant all on table public.subscription_change_reconciliation to service_role;
