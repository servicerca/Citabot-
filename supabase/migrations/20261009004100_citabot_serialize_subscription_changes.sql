-- Serialize each business's plan-change attempt before calling the payment provider.
-- Keep unresolved attempts durable so retries cannot generate another subscription.
alter table public.subscription_change_reconciliation
  alter column new_subscription_id drop not null;

alter table public.subscription_change_reconciliation
  drop constraint if exists subscription_change_reconciliation_phase_check;

alter table public.subscription_change_reconciliation
  add constraint subscription_change_reconciliation_phase_check
  check (phase in (
    'initiating',
    'provider_created',
    'local_pending_saved',
    'old_subscription_cancelled',
    'rollback_started',
    'rolled_back',
    'local_restore_failed',
    'rollback_unconfirmed',
    'finished'
  ));

drop index if exists public.subscription_change_reconciliation_business_state_idx;

create unique index if not exists subscription_change_reconciliation_one_unresolved_per_business_idx
  on public.subscription_change_reconciliation (business_id)
  where state in ('in_progress', 'reconciliation_required');
