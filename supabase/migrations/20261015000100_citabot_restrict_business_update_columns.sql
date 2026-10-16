-- Limit authenticated business-owner updates to fields the current workspace UI edits.
-- Keep listing preferences self-service, but reserve lifecycle, ownership, identity,
-- and public-slug fields for trusted backend/platform workflows.
BEGIN;

REVOKE UPDATE ON TABLE public.businesses FROM PUBLIC, anon, authenticated;

GRANT UPDATE (
  name,
  city,
  address,
  phone,
  whatsapp,
  is_listed,
  latitude,
  longitude,
  updated_at
) ON TABLE public.businesses TO authenticated;

COMMIT;
