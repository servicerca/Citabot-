-- CitaBot production cleanup: remove empty legacy appointment fields and redundant indexes.
-- No production row data is deleted by this migration.

alter table public.appointments
  drop constraint if exists appointments_client_id_fkey;

alter table public.appointments
  drop column if exists client_id,
  drop column if exists appointment_date,
  drop column if exists start_time,
  drop column if exists end_time,
  drop column if exists notes;

drop index if exists public.idx_appointments_business;
drop index if exists public.idx_appointments_client;
drop index if exists public.idx_appointments_date;
drop index if exists public.messages_customer_idx;

drop index if exists public.business_integrations_provider_phone_uidx;
drop index if exists public.business_integrations_whatsapp_phone_unique_idx;

drop index if exists public.subscriptions_business_idx;
