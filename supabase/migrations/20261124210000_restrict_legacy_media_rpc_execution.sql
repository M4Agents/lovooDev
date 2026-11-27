-- =============================================================================
-- META-L1.4C.5.1E.3E.4F.C.2B.1B
-- Contenção de execução das RPCs legadas de mídia.
--
-- Revoga EXECUTE de PUBLIC, anon e authenticated.
-- Mantém o grant de service_role e o privilégio do owner postgres.
-- Fixa search_path com pg_catalog e public antes de pg_temp.
-- Não altera corpo, assinatura, owner, linguagem nem volatilidade.
-- Não corrige o argumento uuid de lead_id nem a concorrência da pasta.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.get_or_create_chat_folder(uuid)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.save_chat_media(uuid, uuid, text, text, text, text, bigint, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.get_or_create_chat_folder(uuid)
  SET search_path TO pg_catalog, public, pg_temp;

ALTER FUNCTION public.save_chat_media(uuid, uuid, text, text, text, text, bigint, text, uuid, uuid)
  SET search_path TO pg_catalog, public, pg_temp;
