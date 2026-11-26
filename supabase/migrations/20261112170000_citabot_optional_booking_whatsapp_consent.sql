CREATE OR REPLACE FUNCTION public.book_appointment_v2(p_business_slug text, p_service_id uuid, p_staff_id uuid, p_customer_name text, p_customer_phone text, p_customer_email text DEFAULT NULL::text, p_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_customer_notes text DEFAULT NULL::text, p_privacy_consent boolean DEFAULT false, p_whatsapp_consent boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_business_id uuid;
  v_business_timezone text;
  v_customer_id uuid;
  v_duration integer;
  v_end timestamptz;
  v_appointment_id uuid;
  v_dow integer;
  v_hour public.business_hours%rowtype;
  v_phone_normalized text;
begin
  if not p_privacy_consent then raise exception 'Debes aceptar la política de privacidad para reservar'; end if;

  select id,coalesce(timezone,'America/Bogota')
    into v_business_id,v_business_timezone
  from public.businesses
  where slug=lower(trim(p_business_slug))
    and is_active=true
    and is_listed=true
  limit 1;

  if v_business_id is null then raise exception 'Negocio no disponible'; end if;

  select duration_minutes into v_duration
  from public.services
  where id=p_service_id and business_id=v_business_id and active=true;
  if v_duration is null then raise exception 'Servicio no disponible'; end if;

  if p_staff_id is not null and not exists (
    select 1 from public.staff where id=p_staff_id and business_id=v_business_id and active=true
  ) then
    raise exception 'Profesional no disponible';
  end if;

  if p_starts_at is null then raise exception 'Fecha y hora requeridas'; end if;
  if p_starts_at <= now() then raise exception 'La fecha y hora deben ser futuras'; end if;
  if p_starts_at > now()+interval '365 days' then
    raise exception 'La reserva no puede superar 365 días de anticipación';
  end if;

  if length(trim(coalesce(p_customer_name,'')))=0 then raise exception 'Nombre requerido'; end if;
  if length(trim(coalesce(p_customer_name,'')))>120 then raise exception 'Nombre demasiado largo'; end if;
  if length(trim(coalesce(p_customer_phone,'')))=0 then raise exception 'WhatsApp requerido'; end if;
  if length(trim(coalesce(p_customer_phone,'')))>40 then raise exception 'WhatsApp demasiado largo'; end if;
  if length(trim(coalesce(p_customer_email,'')))>160 then raise exception 'Email demasiado largo'; end if;
  if length(coalesce(p_customer_notes,''))>1000 then raise exception 'Nota demasiado larga'; end if;

  v_phone_normalized := nullif(regexp_replace(trim(coalesce(p_customer_phone,'')), '[^0-9]', '', 'g'), '');
  if v_phone_normalized is null then raise exception 'WhatsApp no válido'; end if;

  v_end:=p_starts_at+make_interval(mins=>v_duration);
  v_dow:=extract(dow from (p_starts_at at time zone v_business_timezone))::integer;

  select * into v_hour
  from public.business_hours
  where business_id=v_business_id and day_of_week=v_dow
  limit 1;

  if not found or coalesce(v_hour.closed,not v_hour.is_open) then
    raise exception 'El negocio está cerrado ese día';
  end if;

  if (p_starts_at at time zone v_business_timezone)::time < coalesce(v_hour.opens_at,v_hour.opening_time)
     or (v_end at time zone v_business_timezone)::time > coalesce(v_hour.closes_at,v_hour.closing_time)
  then
    raise exception 'La hora está fuera del horario del negocio';
  end if;

  insert into public.customers(business_id,name,phone,email,notes)
  values(
    v_business_id,trim(p_customer_name),trim(p_customer_phone),
    nullif(trim(coalesce(p_customer_email,'')),''),
    p_customer_notes
  )
  on conflict (business_id,phone_normalized) do update
  set name=excluded.name,
      email=coalesce(excluded.email,public.customers.email),
      phone=excluded.phone,
      notes=coalesce(excluded.notes,public.customers.notes),
      updated_at=now()
  returning id into v_customer_id;

  insert into public.appointments(
    business_id,service_id,staff_id,customer_id,starts_at,ends_at,status,customer_notes,
    privacy_consent_at,whatsapp_consent_at,legal_policy_version
  )
  values(
    v_business_id,p_service_id,p_staff_id,v_customer_id,p_starts_at,v_end,'confirmed',p_customer_notes,
    now(),case when p_whatsapp_consent then now() else null end,'2026-09-25-v1'
  )
  returning id into v_appointment_id;

  insert into public.legal_acceptances(user_id,business_id,appointment_id,document,version,context,metadata)
  values
    (null,v_business_id,v_appointment_id,'privacy','2026-09-25-v1','public_booking',jsonb_build_object('consent','reservation'));

  if p_whatsapp_consent then
    insert into public.legal_acceptances(user_id,business_id,appointment_id,document,version,context,metadata)
    values
      (null,v_business_id,v_appointment_id,'whatsapp','2026-09-25-v1','public_booking',jsonb_build_object('consent','reservation_contact'));
  end if;

  return v_appointment_id;
exception when exclusion_violation then
  raise exception 'Ese profesional ya tiene una cita en ese horario.';
end;
$function$;

REVOKE ALL ON FUNCTION public.book_appointment_v2(text,uuid,uuid,text,text,text,timestamptz,text,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.book_appointment_v2(text,uuid,uuid,text,text,text,timestamptz,text,boolean,boolean) TO service_role;
