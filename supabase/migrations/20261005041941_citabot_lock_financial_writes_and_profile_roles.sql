-- Lock financial state to server-side functions and prevent profile-role escalation.
-- Idempotent migration: permissions/triggers only; no business data is modified.

drop policy if exists subscriptions_admin_access on public.subscriptions;
drop policy if exists subscriptions_business_read on public.subscriptions;
create policy subscriptions_business_read
on public.subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.business_members bm
    where bm.business_id = subscriptions.business_id
      and bm.user_id = (select auth.uid())
      and bm.role in ('owner','admin')
  )
);

drop policy if exists payments_admin_access on public.payments;
drop policy if exists payments_business_read on public.payments;
create policy payments_business_read
on public.payments
for select
to authenticated
using (
  exists (
    select 1
    from public.business_members bm
    where bm.business_id = payments.business_id
      and bm.user_id = (select auth.uid())
      and bm.role in ('owner','admin')
  )
);

drop policy if exists directory_boost_orders_admin_access on public.directory_boost_orders;
drop policy if exists directory_boost_orders_business_read on public.directory_boost_orders;
create policy directory_boost_orders_business_read
on public.directory_boost_orders
for select
to authenticated
using (
  exists (
    select 1
    from public.business_members bm
    where bm.business_id = directory_boost_orders.business_id
      and bm.user_id = (select auth.uid())
      and bm.role in ('owner','admin')
  )
);

create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user <> 'service_role' then
    if tg_op = 'INSERT' then
      new.role := 'client';
    elsif new.role is distinct from old.role then
      new.role := old.role;
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_prevent_profile_role_escalation on public.profiles;
create trigger trg_prevent_profile_role_escalation
before insert or update on public.profiles
for each row
execute function public.prevent_profile_role_escalation();
