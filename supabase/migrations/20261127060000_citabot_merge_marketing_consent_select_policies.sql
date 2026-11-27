BEGIN;

-- Keep both existing read paths while avoiding duplicate permissive SELECT policies.
GRANT SELECT ON TABLE public.legal_acceptances TO authenticated;

DROP POLICY IF EXISTS legal_acceptances_business_marketing_select
  ON public.legal_acceptances;
DROP POLICY IF EXISTS legal_acceptances_select_own
  ON public.legal_acceptances;

CREATE POLICY legal_acceptances_select_scoped
ON public.legal_acceptances
FOR SELECT
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR (
    document = 'whatsapp'
    AND context = 'public_booking_marketing'
    AND metadata ->> 'purpose' = 'marketing'
    AND EXISTS (
      SELECT 1
      FROM public.business_members AS bm
      WHERE bm.business_id = legal_acceptances.business_id
        AND bm.user_id = (SELECT auth.uid())
    )
  )
);

COMMIT;
