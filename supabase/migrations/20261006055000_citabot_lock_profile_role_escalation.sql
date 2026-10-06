-- Prevent authenticated users from escalating their profile role.
-- Profile creation remains controlled by the Auth trigger.
-- Authenticated users may only update self-service contact fields.

revoke insert on table public.profiles from authenticated;
revoke update on table public.profiles from authenticated;
grant update (full_name, phone, updated_at) on table public.profiles to authenticated;
