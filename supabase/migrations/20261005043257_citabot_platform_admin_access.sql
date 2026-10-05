create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  is_active boolean not null default true
);

alter table public.platform_admins enable row level security;

grant select on public.platform_admins to authenticated;

create policy "platform_admins_self_read"
on public.platform_admins
for select
to authenticated
using ((select auth.uid()) = user_id and is_active = true);

insert into public.platform_admins (user_id)
select bm.user_id
from public.business_members bm
join public.businesses b on b.id = bm.business_id
where bm.role = 'owner'
  and b.is_active = true
group by bm.user_id
having count(*) = 1;
