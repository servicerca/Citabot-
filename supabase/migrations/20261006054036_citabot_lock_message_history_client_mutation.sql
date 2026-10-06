-- Keep message history under trusted backend control.
-- The UI only reads messages; outbound sends and inbound webhook processing use server-side service-role flows.

revoke insert, update, delete on table public.messages from authenticated;
