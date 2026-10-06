-- Persist account signup legal acceptance from Auth metadata at the database boundary.
-- The existing client-side recorder remains as a compatibility fallback; it sees these rows
-- and will not insert duplicates.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do update set full_name=excluded.full_name;

  if coalesce(new.raw_user_meta_data->>'citabot_legal_accepted','false') = 'true'
     and coalesce(new.raw_user_meta_data->>'citabot_legal_version','') = '2026-09-25-v1' then
    if not exists (
      select 1 from public.legal_acceptances
      where user_id=new.id and document='terms' and version='2026-09-25-v1' and context='account_signup'
    ) then
      insert into public.legal_acceptances(
        user_id,document,version,context,accepted_at,metadata
      ) values (
        new.id,'terms','2026-09-25-v1','account_signup',now(),
        jsonb_build_object('source','auth_trigger','accepted_at',new.raw_user_meta_data->>'citabot_legal_accepted_at')
      );
    end if;

    if not exists (
      select 1 from public.legal_acceptances
      where user_id=new.id and document='privacy' and version='2026-09-25-v1' and context='account_signup'
    ) then
      insert into public.legal_acceptances(
        user_id,document,version,context,accepted_at,metadata
      ) values (
        new.id,'privacy','2026-09-25-v1','account_signup',now(),
        jsonb_build_object('source','auth_trigger','accepted_at',new.raw_user_meta_data->>'citabot_legal_accepted_at')
      );
    end if;
  end if;

  return new;
end;
$function$;