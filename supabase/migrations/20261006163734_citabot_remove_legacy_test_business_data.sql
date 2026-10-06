-- Remove the single legacy test business created during pre-production validation.
-- This deliberately preserves the owning Auth account/profile; only business-scoped test data is removed.

do $$
declare
  v_business uuid := '7a1bf498-6f7d-4510-bd4c-0c32f3a87de5';
begin
  delete from public.legal_acceptances
   where business_id = v_business
      or appointment_id in (select id from public.appointments where business_id = v_business);

  delete from public.platform_revenue where business_id = v_business;
  delete from public.directory_boost_orders where business_id = v_business;
  delete from public.payments where business_id = v_business;
  delete from public.business_promotions where business_id = v_business;
  delete from public.business_directory where business_id = v_business;
  delete from public.business_integrations where business_id = v_business;
  delete from public.messages where business_id = v_business;
  delete from public.campaigns where business_id = v_business;
  delete from public.appointments where business_id = v_business;
  delete from public.customers where business_id = v_business;
  delete from public.staff where business_id = v_business;
  delete from public.services where business_id = v_business;
  delete from public.business_hours where business_id = v_business;
  delete from public.subscriptions where business_id = v_business;
  delete from public.business_members where business_id = v_business;
  delete from public.businesses where id = v_business;
end
$$;
