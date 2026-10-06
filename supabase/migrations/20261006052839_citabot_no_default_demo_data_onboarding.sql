-- CitaBot production onboarding hardening: never create synthetic staff, services, or hours.
-- New businesses are created only with the data explicitly provided by the user.
-- Existing production data is preserved.

create or replace function public.create_citabot_business_onboarding(
  p_name text,
  p_category text,
  p_city text default null::text,
  p_phone text default null::text,
  p_email text default null::text
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text := trim(coalesce(p_name,''));
  v_category text := lower(trim(coalesce(p_category,'service')));
  v_city text := nullif(trim(coalesce(p_city,'')),'');
  v_phone text := nullif(trim(coalesce(p_phone,'')),'');
  v_email text := nullif(trim(coalesce(p_email,'')),'');
  v_slug text;
  v_base_slug text;
  v_suffix integer := 1;
  v_business public.businesses%rowtype;
  v_trial_started timestamptz := now();
  v_trial_ends timestamptz := now()+interval '7 days';
begin
  if v_user_id is null then raise exception 'Sesión requerida'; end if;
  if v_name='' then raise exception 'El nombre del negocio es obligatorio'; end if;
  if length(v_name)>120 then raise exception 'El nombre del negocio es demasiado largo'; end if;
  if v_category not in ('service','restaurant') then raise exception 'Categoría no válida'; end if;
  if v_city is not null and length(v_city)>120 then raise exception 'La ciudad es demasiado larga'; end if;
  if v_phone is not null and length(v_phone)>40 then raise exception 'El WhatsApp es demasiado largo'; end if;
  if v_email is not null and length(v_email)>160 then raise exception 'El correo es demasiado largo'; end if;

  v_base_slug := lower(regexp_replace(
    regexp_replace(v_name,'[^[:alnum:][:space:]-]','','g'),
    '[[:space:]-]+','-','g'
  ));
  v_base_slug := trim(both '-' from v_base_slug);
  if v_base_slug='' then v_base_slug := 'negocio'; end if;
  v_base_slug := left(v_base_slug,60);
  v_slug := v_base_slug;

  while exists(select 1 from public.businesses b where b.slug=v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := left(v_base_slug, max(1, 60-length(v_suffix::text)-1)) || '-' || v_suffix::text;
  end loop;

  insert into public.businesses(
    owner_id,name,slug,category,city,phone,whatsapp,timezone,is_active,is_listed
  )
  values(
    v_user_id,v_name,v_slug,v_category,v_city,v_phone,v_phone,'America/Bogota',true,false
  )
  returning * into v_business;

  insert into public.business_members(business_id,user_id,role)
  values(v_business.id,v_user_id,'owner');

  insert into public.subscriptions(
    business_id,plan,status,trial_started_at,trial_ends_at,provider
  )
  values(
    v_business.id,'trial','trialing',v_trial_started,v_trial_ends,'citabot'
  );

  return jsonb_build_object(
    'business', to_jsonb(v_business),
    'trial', jsonb_build_object(
      'plan','trial','status','trialing',
      'trial_started_at',v_trial_started,'trial_ends_at',v_trial_ends
    )
  );
end;
$function$;
