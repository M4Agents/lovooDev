-- =============================================================================
-- Fase 0 / Lote 0B.8 — Grants e exposição controlada das RPCs canônicas
-- =============================================================================
-- Escopo: somente permissões EXECUTE das funções canônicas Fase 0.
-- Não altera: owner, SECURITY DEFINER, search_path, corpo, RLS, tabelas,
-- RPCs legadas, backend/frontend.
--
-- Contexto PostgreSQL/Supabase:
--   CREATE FUNCTION concede EXECUTE a PUBLIC por padrão. Sem REVOKE PUBLIC,
--   helpers internos ficariam invocáveis por anon/authenticated via PostgREST.
--   Esta migration remove essa exposição padrão e versiona a matriz desejada.
--
-- Helpers internos (sem EXECUTE para cliente):
--   public.resolve_tracking_landing_page(uuid)
--   public.resolve_tracking_visit(uuid, uuid, uuid)
--   → REVOKE PUBLIC, anon, authenticated
--   → sem GRANT a roles de API
--   → permanecem invocáveis pelas RPCs canônicas SECURITY DEFINER do mesmo owner
--
-- RPCs públicas canônicas:
--   public.public_create_tracking_visit(...)
--   public.public_create_tracking_behavior_event(...)
--   public.public_create_tracking_conversion(...)
--   public.public_create_tracking_lead(...)
--   → REVOKE PUBLIC
--   → GRANT EXECUTE TO anon, authenticated
--   → sem GRANT a service_role (nenhuma necessidade comprovada neste lote;
--     backend pode usar anon key / JWT authenticated quando for ligado)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helpers internos — fechar exposição padrão e direta
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.resolve_tracking_landing_page(uuid)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_tracking_landing_page(uuid)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_tracking_landing_page(uuid)
  FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_tracking_visit(uuid, uuid, uuid)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_tracking_visit(uuid, uuid, uuid)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.resolve_tracking_visit(uuid, uuid, uuid)
  FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2) RPCs públicas canônicas — PUBLIC off; anon + authenticated on
-- ---------------------------------------------------------------------------

-- public_create_tracking_visit(
--   text, text, text, text, text, text, text, text, text
-- )
REVOKE EXECUTE ON FUNCTION public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text
) TO anon;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_visit(
  text, text, text, text, text, text, text, text, text
) TO authenticated;

-- public_create_tracking_behavior_event(
--   text, text, text, text, jsonb, text
-- )
REVOKE EXECUTE ON FUNCTION public.public_create_tracking_behavior_event(
  text, text, text, text, jsonb, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_behavior_event(
  text, text, text, text, jsonb, text
) TO anon;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_behavior_event(
  text, text, text, text, jsonb, text
) TO authenticated;

-- public_create_tracking_conversion(
--   text, text, text, text, numeric, jsonb
-- )
REVOKE EXECUTE ON FUNCTION public.public_create_tracking_conversion(
  text, text, text, text, numeric, jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_conversion(
  text, text, text, text, numeric, jsonb
) TO anon;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_conversion(
  text, text, text, text, numeric, jsonb
) TO authenticated;

-- public_create_tracking_lead(
--   text, text, text, text, text, text, text, text, text, text, text, text, text, text
-- )
REVOKE EXECUTE ON FUNCTION public.public_create_tracking_lead(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_lead(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO anon;

GRANT EXECUTE ON FUNCTION public.public_create_tracking_lead(
  text, text, text, text, text, text, text, text, text, text, text, text, text, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Matriz final (após esta migration):
--
-- Função                                         | PUBLIC | anon | authenticated | service_role
-- ---------------------------------------------- | ------ | ---- | ------------- | ------------
-- resolve_tracking_landing_page(uuid)            | REVOKE | REVOKE | REVOKE      | sem GRANT*
-- resolve_tracking_visit(uuid,uuid,uuid)         | REVOKE | REVOKE | REVOKE      | sem GRANT*
-- public_create_tracking_visit(9× text)          | REVOKE | GRANT | GRANT        | sem GRANT*
-- public_create_tracking_behavior_event(...)     | REVOKE | GRANT | GRANT        | sem GRANT*
-- public_create_tracking_conversion(...)         | REVOKE | GRANT | GRANT        | sem GRANT*
-- public_create_tracking_lead(14× text)          | REVOKE | GRANT | GRANT        | sem GRANT*
--
-- * Após REVOKE PUBLIC, service_role não herda EXECUTE por padrão; nenhum
--   GRANT explícito a service_role neste lote.
-- * Helpers continuam utilizáveis por SECURITY DEFINER canônicas do mesmo owner.
-- ---------------------------------------------------------------------------
