-- =====================================================
-- MIGRATION: RPC upsert_user_funnel_settings
-- Data: 23/06/2026
--
-- Objetivo:
--   RPC SECURITY DEFINER para criar ou atualizar configuração de
--   controle de funis para um usuário específico.
--   Única forma autorizada de escrever em user_funnel_settings
--   e user_allowed_funnels.
--
-- Parâmetros:
--   p_company_id         UUID      empresa alvo
--   p_user_id            UUID      usuário alvo (não o chamador)
--   p_is_enabled         BOOLEAN   ativar controle de funis para o usuário
--   p_default_funnel_id  UUID      funil padrão (NULL = sem padrão)
--   p_allowed_funnel_ids UUID[]    lista de funis permitidos (NULL = sem restrição)
--
-- Validações:
--   A) Chamador é auth_user_is_company_admin(p_company_id)
--   B) Usuário alvo é membro ativo da empresa
--   C) (quando is_enabled=true) default_funnel_id pertence à empresa
--   D) (quando is_enabled=true) todos os IDs em allowed_funnel_ids pertencem à empresa
--   E) (quando is_enabled=true e lista não NULL) default_funnel_id deve estar na lista
--   F) Array vazio [] é rejeitado — usar NULL para "sem lista restrita"
--
-- Comportamento quando p_is_enabled = false:
--   Salva is_enabled = false, anula default_funnel_id, deleta user_allowed_funnels.
--   Usuário volta a ver todos os funis.
--
-- Comportamento quando p_is_enabled = true + p_allowed_funnel_ids = NULL:
--   Salva is_enabled = true sem lista restrita.
--   Usuário vê todos os funis (pode ter funil padrão configurado).
--
-- Segurança:
--   SECURITY DEFINER: acessa tabelas protegidas por RLS
--   SET search_path = public: previne search_path injection
--   Validação de autorização explícita (não confia apenas em RLS)
-- =====================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION upsert_user_funnel_settings(
  p_company_id         UUID,
  p_user_id            UUID,
  p_is_enabled         BOOLEAN,
  p_default_funnel_id  UUID    DEFAULT NULL,
  p_allowed_funnel_ids UUID[]  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_funnel_id UUID;
BEGIN
  -- ── A) Chamador deve ser admin da empresa ──────────────────────────────
  IF NOT auth_user_is_company_admin(p_company_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: chamador não é admin da empresa';
  END IF;

  -- ── B) Usuário alvo deve ser membro ativo ──────────────────────────────
  IF NOT EXISTS (
    SELECT 1 FROM company_users
    WHERE company_id = p_company_id
      AND user_id    = p_user_id
      AND is_active  = true
  ) THEN
    RAISE EXCEPTION 'USER_NOT_MEMBER: usuário não é membro ativo da empresa';
  END IF;

  -- ── Comportamento quando is_enabled = false ────────────────────────────
  -- Normalizar: zerar default_funnel_id, deletar lista, salvar is_enabled=false.
  IF NOT p_is_enabled THEN
    INSERT INTO user_funnel_settings (company_id, user_id, is_enabled, default_funnel_id)
    VALUES (p_company_id, p_user_id, false, NULL)
    ON CONFLICT (company_id, user_id) DO UPDATE SET
      is_enabled        = false,
      default_funnel_id = NULL,
      updated_at        = NOW();

    DELETE FROM user_allowed_funnels
    WHERE company_id = p_company_id
      AND user_id    = p_user_id;

    RETURN;
  END IF;

  -- ── Validações adicionais quando is_enabled = true ─────────────────────

  -- C) default_funnel_id deve pertencer à empresa
  IF p_default_funnel_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM sales_funnels
      WHERE id         = p_default_funnel_id
        AND company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'INVALID_DEFAULT_FUNNEL: funil padrão não pertence à empresa';
    END IF;
  END IF;

  -- D+F) Validar array de funis permitidos
  IF p_allowed_funnel_ids IS NOT NULL THEN
    -- Rejeitar array vazio — usar NULL para "sem lista"
    IF array_length(p_allowed_funnel_ids, 1) IS NULL OR array_length(p_allowed_funnel_ids, 1) = 0 THEN
      RAISE EXCEPTION 'EMPTY_ALLOWED_LIST: use NULL em vez de array vazio para indicar "sem restrição"';
    END IF;

    -- D) Cada funil da lista deve pertencer à empresa
    FOREACH v_funnel_id IN ARRAY p_allowed_funnel_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM sales_funnels
        WHERE id         = v_funnel_id
          AND company_id = p_company_id
      ) THEN
        RAISE EXCEPTION 'INVALID_FUNNEL_IN_LIST: funil % não pertence à empresa %',
          v_funnel_id, p_company_id;
      END IF;
    END LOOP;

    -- E) default_funnel_id deve estar dentro da lista (quando lista existe)
    IF p_default_funnel_id IS NOT NULL
       AND NOT (p_default_funnel_id = ANY(p_allowed_funnel_ids))
    THEN
      RAISE EXCEPTION 'DEFAULT_NOT_IN_ALLOWED_LIST: funil padrão deve estar na lista de funis permitidos';
    END IF;
  END IF;

  -- ── Upsert user_funnel_settings ────────────────────────────────────────
  INSERT INTO user_funnel_settings (company_id, user_id, is_enabled, default_funnel_id)
  VALUES (p_company_id, p_user_id, true, p_default_funnel_id)
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    is_enabled        = true,
    default_funnel_id = EXCLUDED.default_funnel_id,
    updated_at        = NOW();

  -- ── Sincronizar user_allowed_funnels ───────────────────────────────────
  -- Deletar lista anterior e reinserir
  DELETE FROM user_allowed_funnels
  WHERE company_id = p_company_id
    AND user_id    = p_user_id;

  IF p_allowed_funnel_ids IS NOT NULL THEN
    FOREACH v_funnel_id IN ARRAY p_allowed_funnel_ids LOOP
      INSERT INTO user_allowed_funnels (company_id, user_id, funnel_id)
      VALUES (p_company_id, p_user_id, v_funnel_id);
    END LOOP;
  END IF;
END;
$$;

-- Permissão para usuários autenticados chamarem a RPC
GRANT EXECUTE ON FUNCTION upsert_user_funnel_settings(UUID, UUID, BOOLEAN, UUID, UUID[])
  TO authenticated;

COMMENT ON FUNCTION upsert_user_funnel_settings(UUID, UUID, BOOLEAN, UUID, UUID[]) IS
  'Cria ou atualiza configuração de acesso a funis para um usuário. '
  'Apenas admins da empresa podem chamar. '
  'is_enabled=false: zera tudo (usuário vê todos os funis). '
  'is_enabled=true + allowed_funnel_ids=NULL: sem restrição (pode ter funil padrão). '
  'is_enabled=true + allowed_funnel_ids=[...]: restrito à lista.';
