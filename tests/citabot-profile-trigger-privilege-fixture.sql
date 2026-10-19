-- Disposable fixture for validating direct privileges on trigger-only functions.
-- Runs only in CI's temporary PostgreSQL service; never run against production.
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  role text NOT NULL
);

CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF current_user <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.role := 'client';
    ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
      NEW.role := OLD.role;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_prevent_profile_role_escalation
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_role_escalation();

-- Model the unnecessary default/explicit API execution grants found in production.
GRANT EXECUTE ON FUNCTION public.prevent_profile_role_escalation()
  TO PUBLIC, anon, authenticated, service_role;
