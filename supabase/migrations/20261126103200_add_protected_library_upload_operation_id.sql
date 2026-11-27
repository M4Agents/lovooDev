BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
LOCK TABLE public.lead_media_unified IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.lead_media_unified
  ADD COLUMN operation_id uuid;

ALTER TABLE public.lead_media_unified
  ADD CONSTRAINT lead_media_unified_company_operation_id_key
  UNIQUE (company_id, operation_id)
  NOT DEFERRABLE;

CREATE FUNCTION private.protect_library_operation_id()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.operation_id IS NOT NULL
       AND current_user NOT IN ('service_role', 'postgres') THEN
      RAISE EXCEPTION 'operation_id não pode ser definido por este papel'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
      RAISE EXCEPTION 'operation_id não pode ser alterado'
        USING ERRCODE = '42501';
    END IF;

    IF OLD.operation_id IS NOT NULL
       AND (
         NEW.s3_key IS DISTINCT FROM OLD.s3_key
         OR NEW.file_size IS DISTINCT FROM OLD.file_size
         OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
         OR NEW.file_type IS DISTINCT FROM OLD.file_type
       ) THEN
      RAISE EXCEPTION 'identidade do upload idempotente não pode ser alterada'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

ALTER FUNCTION private.protect_library_operation_id()
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.protect_library_operation_id()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zzz_protect_library_operation_id
  BEFORE INSERT OR UPDATE
  ON public.lead_media_unified
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_library_operation_id();

ALTER TABLE public.lead_media_unified
  ENABLE ALWAYS TRIGGER zzz_protect_library_operation_id;

COMMIT;
