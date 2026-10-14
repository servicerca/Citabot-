-- Disposable CI fixture representing the currently deployed constraint.
CREATE TABLE public.directory_boost_orders (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'COP',
  status text NOT NULL DEFAULT 'pending',
  CONSTRAINT directory_boost_orders_status_check
    CHECK (status IN ('pending', 'paid', 'failed', 'cancelled', 'expired'))
);
