-- =============================================================================
-- FASE 5Z: HELPERS V2 — CRM É FONTE DE VERDADE DO CHAT
-- =============================================================================
-- Arquivo: 20260612190000_helpers_v2_crm_is_source_of_truth.sql
-- Substitui: 20260611190000_sync_lead_responsible_to_conversations.sql
--
-- Mudanças:
--   sync_lead_responsible_to_conversations
--     • p_responsible_user_id = NULL agora é suportado (limpa assigned_to)
--     • IS NULL → IS DISTINCT FROM (sobrescrita ativa — CRM manda no Chat)
--
--   bulk_sync_lead_responsible_to_conversations
--     • Mesma lógica de NULL e IS DISTINCT FROM
--
-- Regra de negócio:
--   leads.responsible_user_id = fonte canônica
--   chat_conversations.assigned_to = reflexo
--   Remoção de responsável → assigned_to = NULL
--   Troca de responsável   → assigned_to sobrescrito (IS DISTINCT FROM)
--
-- Segurança:
--   • SECURITY DEFINER + SET search_path = public
--   • Membership ativo validado para o caso UUID
--   • Caso NULL: sem validação de membership (não há usuário alvo)
--   • Nunca usa auth.uid()
--   • Isolamento multi-tenant garantido via company_id do lead
-- =============================================================================

-- ─── sync_lead_responsible_to_conversations V2 ───────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_lead_responsible_to_conversations(
  p_lead_id             INTEGER,
  p_responsible_user_id UUID        -- NULL permitido: limpar assigned_to
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_updated    INTEGER;
BEGIN
  -- p_lead_id é obrigatório; p_responsible_user_id = NULL é válido (clear)
  IF p_lead_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT company_id INTO v_company_id
  FROM leads
  WHERE id         = p_lead_id
    AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- ── Caso NULL: remover responsável → limpar assigned_to ───────────────────
  IF p_responsible_user_id IS NULL THEN
    UPDATE chat_conversations
    SET
      assigned_to = NULL,
      updated_at  = now()
    WHERE lead_id    = p_lead_id
      AND company_id = v_company_id
      AND assigned_to IS NOT NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
  END IF;

  -- ── Caso UUID: validar membership ativo + sobrescrever se divergente ──────
  IF NOT EXISTS (
    SELECT 1
    FROM company_users
    WHERE user_id    = p_responsible_user_id
      AND company_id = v_company_id
      AND is_active  = true
  ) THEN
    RETURN 0;
  END IF;

  -- IS DISTINCT FROM: sobrescreve mesmo quando assigned_to já tem outro valor
  UPDATE chat_conversations
  SET
    assigned_to = p_responsible_user_id,
    updated_at  = now()
  WHERE lead_id    = p_lead_id
    AND company_id = v_company_id
    AND assigned_to IS DISTINCT FROM p_responsible_user_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- ─── bulk_sync_lead_responsible_to_conversations V2 ──────────────────────────

CREATE OR REPLACE FUNCTION public.bulk_sync_lead_responsible_to_conversations(
  p_lead_ids            INTEGER[],
  p_responsible_user_id UUID,         -- NULL permitido: bulk clear
  p_company_id          UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  -- p_lead_ids e p_company_id são obrigatórios; p_responsible_user_id = NULL é válido
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) = 0
     OR p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- ── Caso NULL: bulk clear ──────────────────────────────────────────────────
  IF p_responsible_user_id IS NULL THEN
    UPDATE chat_conversations
    SET
      assigned_to = NULL,
      updated_at  = now()
    WHERE lead_id    = ANY(p_lead_ids)
      AND company_id = p_company_id
      AND assigned_to IS NOT NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated;
  END IF;

  -- ── Caso UUID: validar membership ativo + sobrescrever se divergente ──────
  IF NOT EXISTS (
    SELECT 1
    FROM company_users
    WHERE user_id    = p_responsible_user_id
      AND company_id = p_company_id
      AND is_active  = true
  ) THEN
    RETURN 0;
  END IF;

  UPDATE chat_conversations
  SET
    assigned_to = p_responsible_user_id,
    updated_at  = now()
  WHERE lead_id    = ANY(p_lead_ids)
    AND company_id = p_company_id
    AND assigned_to IS DISTINCT FROM p_responsible_user_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- ─── GRANTs (mantidos da versão anterior) ─────────────────────────────────

REVOKE ALL ON FUNCTION public.sync_lead_responsible_to_conversations(INTEGER, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_lead_responsible_to_conversations(INTEGER, UUID)
  FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.bulk_sync_lead_responsible_to_conversations(INTEGER[], UUID, UUID)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bulk_sync_lead_responsible_to_conversations(INTEGER[], UUID, UUID)
  FROM anon, authenticated;

-- ─── COMMENTs ─────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.sync_lead_responsible_to_conversations(INTEGER, UUID) IS
  'V2 — CRM é fonte de verdade. '
  'p_responsible_user_id = NULL limpa assigned_to (remoção de responsável). '
  'UUID sobrescreve mesmo quando assigned_to já tem valor diferente (IS DISTINCT FROM). '
  'Valida membership ativo. Nunca usa auth.uid().';

COMMENT ON FUNCTION public.bulk_sync_lead_responsible_to_conversations(INTEGER[], UUID, UUID) IS
  'V2 — Bulk de sync_lead_responsible_to_conversations. '
  'NULL = bulk clear de assigned_to. IS DISTINCT FROM substitui IS NULL.';
