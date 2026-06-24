-- =====================================================
-- MIGRATION: RPC get_user_funnel_settings
-- Data: 23/06/2026
--
-- Objetivo:
--   Buscar as configurações de controle de funis de um usuário.
--   Retorna tanto as settings base quanto a lista de funis permitidos.
--
-- Parâmetros:
--   p_company_id  UUID  empresa alvo
--   p_user_id     UUID  usuário alvo
--
-- Retorno:
--   TABLE (
--     is_enabled         BOOLEAN,
--     default_funnel_id  UUID,
--     allowed_funnel_ids UUID[]
--   )
--
-- Semântica de retorno (crítica — evitar ambiguidade):
--
--   | Resultado          | Interpretação no frontend        |
--   |--------------------|----------------------------------|
--   | 0 linhas           | is_enabled = false → sem restrição (sem registro) |
--   | is_enabled = false | sem restrição                    |
--   | is_enabled = true + allowed_funnel_ids = {} | sem restrição (lista vazia = acesso total) |
--   | is_enabled = true + allowed_funnel_ids = [id1,...] | restrito à lista |
--
--   NUNCA retornar array vazio como "sem acesso total" —
--   array vazio {} significa controle ativo sem lista configurada.
--
-- Autorização:
--   Apenas o próprio usuário OU admin da empresa pode chamar.
--
-- Segurança:
--   SECURITY DEFINER: acessa user_funnel_settings (RLS do chamador bypassed)
--   SET search_path = public
--   Validação de autorização explícita no início da função
-- =====================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION get_user_funnel_settings(
  p_company_id UUID,
  p_user_id    UUID
)
RETURNS TABLE (
  is_enabled         BOOLEAN,
  default_funnel_id  UUID,
  allowed_funnel_ids UUID[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Apenas o próprio usuário ou admin da empresa pode consultar
  IF auth.uid() != p_user_id
     AND NOT auth_user_is_company_admin(p_company_id)
  THEN
    RAISE EXCEPTION 'UNAUTHORIZED: apenas o próprio usuário ou admin pode consultar';
  END IF;

  RETURN QUERY
  SELECT
    ufs.is_enabled,
    ufs.default_funnel_id,
    COALESCE(
      ARRAY(
        SELECT uaf.funnel_id
        FROM user_allowed_funnels uaf
        WHERE uaf.company_id = p_company_id
          AND uaf.user_id    = p_user_id
        ORDER BY uaf.created_at ASC
      ),
      ARRAY[]::UUID[]
    ) AS allowed_funnel_ids
  FROM user_funnel_settings ufs
  WHERE ufs.company_id = p_company_id
    AND ufs.user_id    = p_user_id;

  -- Se nenhuma linha for retornada (sem registro), o frontend
  -- deve interpretar como is_enabled = false (sem restrição).
END;
$$;

-- Permissão para usuários autenticados chamarem a RPC
GRANT EXECUTE ON FUNCTION get_user_funnel_settings(UUID, UUID)
  TO authenticated;

COMMENT ON FUNCTION get_user_funnel_settings(UUID, UUID) IS
  'Busca configuração de acesso a funis de um usuário. '
  '0 linhas = sem registro = is_enabled=false (sem restrição). '
  'is_enabled=true + allowed_funnel_ids={} = sem restrição (lista vazia ≠ sem acesso). '
  'is_enabled=true + allowed_funnel_ids=[id1,...] = restrito à lista.';
