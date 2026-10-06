-- Prevent more than one pending directory-boost purchase per business.
-- The business can create another boost after the existing pending order changes state.

create unique index if not exists directory_boost_one_pending_per_business
on public.directory_boost_orders (business_id)
where status = 'pending';
