-- =============================================================================
-- FASE 1G: HELPER DE SINCRONIZAÇÃO LEAD → CONVERSA
-- sync_lead_responsible_to_conversations
-- =============================================================================
-- Objetivo:
--   Propagar leads.responsible_user_id para chat_conversations.assigned_to
--   sempre que um responsável de lead for definido ou alterado, garantindo
--   que conversas vinculadas ao lead recebam o responsável operacional
--   apenas quando ainda não houver atribuição manual explícita.
--
-- Contrato:
--   - Atualiza somente chat_conversations.assigned_to e updated_at
--   - Somente conversas com lead_id = p_lead_id
--   - Somente quando assigned_to IS NULL (nunca sobrescreve)
--   - Somente para leads ativos (deleted_at IS NULL — validado pelo caller)
--   - Somente quando p_responsible_user_id é membro ativo da empresa
--   - Retorna INTEGER: quantidade de conversas efetivamente atualizadas
--
-- Segurança:
--   - SECURITY DEFINER + SET search_path = public (evita search_path injection)
--   - REVOKE ALL FROM PUBLIC — sem acesso a 'authenticated' ou 'anon'
--   - Acessível apenas pelo owner da função e service_role (backend /api)
--   - Integração frontend será feita exclusivamente via backend usando service_role
--   - A função não verifica auth.uid() — confia no caller (backend auth)
--   - O JOIN company_users is_active=true garante que usuários desativados
--     nunca recebem atribuição de conversa
--
-- Callers previstos:
--   Backend : api/lib/automation/crmActions.js   → assignLeadOwner()
--   Backend : api/lib/automation/distributionHandler.js
--   Backend : api/leads/import-file.js           → assignResponsible()
--   Frontend: src/services/api.ts                → bulkAssignLeads() via backend
--   Frontend: src/components/WhatsAppChat/LeadPanel/LeadPanel.tsx via backend
--   Frontend: src/components/LeadModal.tsx via backend
--   Frontend: src/components/SalesFunnel/CreateOpportunityModal.tsx via backend
--
-- Referência: Fase 1G — Helper de sincronização lead → conversa
-- =============================================================================

-- ─── FUNÇÃO PRINCIPAL ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_lead_responsible_to_conversations(
  p_lead_id             INTEGER,
  p_responsible_user_id UUID
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
  -- Validação de entrada: parâmetros obrigatórios
  IF p_lead_id IS NULL OR p_responsible_user_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Obter company_id do lead para validação de membership
  -- O lead deve existir, estar ativo e pertencer a uma empresa
  SELECT company_id INTO v_company_id
  FROM leads
  WHERE id         = p_lead_id
    AND deleted_at IS NULL;

  -- Lead não encontrado ou deletado: sair silenciosamente
  IF v_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Validar que p_responsible_user_id é membro ativo da empresa do lead
  -- Garante que nunca atribuímos a um usuário inativo ou de outra empresa
  IF NOT EXISTS (
    SELECT 1
    FROM company_users
    WHERE user_id    = p_responsible_user_id
      AND company_id = v_company_id
      AND is_active  = true
  ) THEN
    RETURN 0;
  END IF;

  -- Atualizar apenas conversas:
  --   1. Vinculadas ao lead via FK direta (lead_id = p_lead_id)
  --   2. Pertencentes à mesma empresa (isolamento multi-tenant)
  --   3. Sem atribuição operacional (assigned_to IS NULL)
  -- Nunca sobrescreve assigned_to já preenchido
  UPDATE chat_conversations
  SET
    assigned_to = p_responsible_user_id,
    updated_at  = now()
  WHERE lead_id     = p_lead_id
    AND company_id  = v_company_id
    AND assigned_to IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$$;

-- ─── FUNÇÃO BULK (para bulkAssignLeads) ──────────────────────────────────────
-- Variante para atribuição em massa: evita N chamadas ao helper principal.
-- Recebe array de lead_ids e um único responsible_user_id.
-- Valida membership uma única vez e atualiza todas as conversas elegíveis.
-- Retorna INTEGER: total de conversas atualizadas em todos os leads.

CREATE OR REPLACE FUNCTION public.bulk_sync_lead_responsible_to_conversations(
  p_lead_ids            INTEGER[],
  p_responsible_user_id UUID,
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
  -- Validação de entrada
  IF p_lead_ids IS NULL OR array_length(p_lead_ids, 1) = 0
     OR p_responsible_user_id IS NULL
     OR p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Validar membership uma única vez para toda a operação bulk
  IF NOT EXISTS (
    SELECT 1
    FROM company_users
    WHERE user_id    = p_responsible_user_id
      AND company_id = p_company_id
      AND is_active  = true
  ) THEN
    RETURN 0;
  END IF;

  -- Atualizar todas as conversas elegíveis dos leads especificados
  -- Isolamento multi-tenant garantido pelo company_id
  -- Não sobrescreve assigned_to já preenchido
  UPDATE chat_conversations
  SET
    assigned_to = p_responsible_user_id,
    updated_at  = now()
  WHERE lead_id    = ANY(p_lead_ids)
    AND company_id = p_company_id
    AND assigned_to IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN v_updated;
END;
$$;

-- ─── GRANTs ──────────────────────────────────────────────────────────────────
-- Revogar acesso público e de usuários autenticados.
-- Funções acessíveis apenas pelo owner e service_role.
-- Integração com frontend será feita via backend (/api) usando service_role.
-- Nenhuma superfície exposta diretamente ao cliente autenticado nesta fase.
-- NOTA: REVOKE FROM PUBLIC não cobre roles nominais do Supabase (anon, authenticated).
-- É necessário revogar explicitamente cada role para anular os default privileges do schema.
REVOKE ALL ON FUNCTION public.sync_lead_responsible_to_conversations(INTEGER, UUID)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION public.sync_lead_responsible_to_conversations(INTEGER, UUID)
  FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.bulk_sync_lead_responsible_to_conversations(INTEGER[], UUID, UUID)
  FROM PUBLIC;

REVOKE ALL ON FUNCTION public.bulk_sync_lead_responsible_to_conversations(INTEGER[], UUID, UUID)
  FROM anon, authenticated;

-- ─── COMENTÁRIOS ─────────────────────────────────────────────────────────────
COMMENT ON FUNCTION public.sync_lead_responsible_to_conversations(INTEGER, UUID) IS
  'Propaga leads.responsible_user_id para chat_conversations.assigned_to '
  'apenas quando assigned_to IS NULL. Valida membership ativo do usuário na empresa. '
  'Retorna quantidade de conversas atualizadas. '
  'Nunca sobrescreve atribuição manual existente.';

COMMENT ON FUNCTION public.bulk_sync_lead_responsible_to_conversations(INTEGER[], UUID, UUID) IS
  'Variante bulk de sync_lead_responsible_to_conversations. '
  'Recebe array de lead_ids e atualiza todas as conversas elegíveis em uma operação. '
  'Usar em bulkAssignLeads() para evitar N chamadas ao helper principal.';
