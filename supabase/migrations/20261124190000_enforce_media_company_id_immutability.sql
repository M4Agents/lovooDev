-- =============================================================================
-- META-L1.4C.5.1E.3E.4F.C.2A
-- Imutabilidade estrutural de company_id nas três tabelas de mídia.
--
-- Em UPDATE, company_id não muda. A comparação é null-safe e não depende de
-- papel, JWT, membership, service_role, postgres nem de função SECURITY DEFINER.
-- INSERT e DELETE não recebem este trigger.
--
-- Não protege source_ref, s3_key, preview_url, thumbnail_s3_key nem exclusão.
-- Não consulta outras tabelas e não grava nada além de aceitar ou recusar
-- a linha já em atualização.
--
-- Os únicos triggers BEFORE UPDATE já instalados chamam
-- update_updated_at_column() e só atribuem NEW.updated_at. O nome zzz_
-- ordena esta verificação depois deles. Sem lista de colunas, a função vê
-- o company_id final caso um trigger anterior o tenha alterado.
-- ENABLE ALWAYS impede que session_replication_role = replica pule a regra.
-- =============================================================================

CREATE FUNCTION private.enforce_media_company_id_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO pg_catalog
AS $fn$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'company_id não pode ser alterado'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

ALTER FUNCTION private.enforce_media_company_id_immutable()
  OWNER TO postgres;

COMMENT ON FUNCTION private.enforce_media_company_id_immutable() IS
  'BEFORE UPDATE das tabelas de mídia. Recusa company_id diferente do valor '
  'anterior, para qualquer papel. Não consulta auth.uid() nem outras tabelas. '
  'SECURITY INVOKER. search_path = pg_catalog.';

REVOKE ALL ON FUNCTION private.enforce_media_company_id_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zzz_enforce_media_company_id_immutable
  BEFORE UPDATE
  ON public.company_folders
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_media_company_id_immutable();

ALTER TABLE public.company_folders
  ENABLE ALWAYS TRIGGER zzz_enforce_media_company_id_immutable;

COMMENT ON TRIGGER zzz_enforce_media_company_id_immutable
  ON public.company_folders IS
  'Impede alteração de company_id. Roda depois do trigger de updated_at.';

CREATE TRIGGER zzz_enforce_media_company_id_immutable
  BEFORE UPDATE
  ON public.lead_media_unified
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_media_company_id_immutable();

ALTER TABLE public.lead_media_unified
  ENABLE ALWAYS TRIGGER zzz_enforce_media_company_id_immutable;

COMMENT ON TRIGGER zzz_enforce_media_company_id_immutable
  ON public.lead_media_unified IS
  'Impede alteração de company_id. Roda depois do trigger de updated_at.';

CREATE TRIGGER zzz_enforce_media_company_id_immutable
  BEFORE UPDATE
  ON public.company_media_library
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_media_company_id_immutable();

ALTER TABLE public.company_media_library
  ENABLE ALWAYS TRIGGER zzz_enforce_media_company_id_immutable;

COMMENT ON TRIGGER zzz_enforce_media_company_id_immutable
  ON public.company_media_library IS
  'Impede alteração de company_id. Roda depois do trigger de updated_at.';
