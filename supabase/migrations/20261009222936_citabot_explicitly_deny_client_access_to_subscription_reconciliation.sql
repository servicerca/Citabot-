-- Subscription reconciliation is backend-only. Keep application roles explicitly denied,
-- while trusted service-role operations continue to bypass RLS.
CREATE POLICY subscription_change_reconciliation_deny_client_access
ON public.subscription_change_reconciliation
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);
