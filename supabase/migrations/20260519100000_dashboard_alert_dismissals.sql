-- =====================================================
-- MIGRATION: dashboard_alert_dismissals
-- Data: 19/05/2026
--
-- Cria:
--   • Tabela dashboard_alert_dismissals
--   • Índices únicos parciais (idempotência compatível com ON CONFLICT ... WHERE)
--   • Índices de suporte para NOT EXISTS nas RPCs
--   • RLS (SELECT / INSERT / DELETE)
--   • Coluna companies.alert_dismissal_scope
--
-- Arquitetura:
--   A dispensa é vinculada à mensagem específica (last_inbound_message_id)
--   que gerou o alerta, não à conversa inteira.
--   Se nova inbound chegar, o id da mensagem muda e o alerta reaparece.
--
-- Rollback:
--   1. Restaurar RPCs canônicas (20260511140000 / 20260509200000)
--   2. Validar dashboard sem referência à tabela
--   3. DROP TABLE dashboard_alert_dismissals
--   4. ALTER TABLE companies DROP COLUMN alert_dismissal_scope
-- =====================================================

-- ----------------------------------------------------
-- 1. Tabela principal
-- ----------------------------------------------------
CREATE TABLE dashboard_alert_dismissals (
  id                      UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id              UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  dismissed_by            UUID        NOT NULL REFERENCES auth.users(id),
  entity_type             TEXT        NOT NULL CHECK (entity_type IN ('conversation', 'opportunity')),
  entity_id               UUID        NOT NULL,
  -- entity_id UUID: chat_conversations.id e opportunities.id são ambos UUID.
  -- seller_risk é alerta agregado — não é dispensável.
  alert_kind              TEXT        NOT NULL CHECK (alert_kind IN ('sla_unanswered', 'stalled_opportunity')),
  -- sla_unanswered cobre sla_high E sla_critical (mesma família — severidade é apresentação).
  last_inbound_message_id UUID,
  -- NOT NULL para sla_unanswered; NULL para stalled_opportunity.
  -- Vincula a dispensa à mensagem que disparou o alerta.
  dismissed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes                   TEXT,

  CONSTRAINT chk_kind_message CHECK (
    (alert_kind = 'sla_unanswered'      AND last_inbound_message_id IS NOT NULL)
    OR
    (alert_kind = 'stalled_opportunity' AND last_inbound_message_id IS NULL)
  )
);

-- ----------------------------------------------------
-- 2. Índices únicos parciais para idempotência
--    Compatíveis com: ON CONFLICT (cols) WHERE predicate DO NOTHING
--    NÃO usar ON CONFLICT ON CONSTRAINT — não funciona com índices parciais.
-- ----------------------------------------------------

-- Um usuário não pode dispensar a mesma mensagem inbound duas vezes
CREATE UNIQUE INDEX uq_dismissal_sla_per_user
  ON dashboard_alert_dismissals (company_id, dismissed_by, last_inbound_message_id)
  WHERE entity_type = 'conversation';

-- Um usuário não pode dispensar a mesma oportunidade duas vezes
CREATE UNIQUE INDEX uq_dismissal_opp_per_user
  ON dashboard_alert_dismissals (company_id, dismissed_by, entity_id)
  WHERE entity_type = 'opportunity';

-- ----------------------------------------------------
-- 3. Índices de suporte para as RPCs (NOT EXISTS)
-- ----------------------------------------------------

-- Busca das RPCs: company + message_id (escopo company inclui qualquer dismissed_by)
CREATE INDEX idx_dismissals_rpc_sla
  ON dashboard_alert_dismissals (company_id, last_inbound_message_id)
  WHERE entity_type = 'conversation';

-- Busca das RPCs: oportunidades dispensadas
CREATE INDEX idx_dismissals_rpc_opp
  ON dashboard_alert_dismissals (company_id, entity_id)
  WHERE entity_type = 'opportunity';

-- Listagem por usuário (undo, eventual painel de gerenciamento)
CREATE INDEX idx_dismissals_by_user
  ON dashboard_alert_dismissals (company_id, dismissed_by);

-- ----------------------------------------------------
-- 4. RLS
-- ----------------------------------------------------
ALTER TABLE dashboard_alert_dismissals ENABLE ROW LEVEL SECURITY;

-- SELECT: membro ativo da empresa pode visualizar
CREATE POLICY "dismissals_select"
  ON dashboard_alert_dismissals
  FOR SELECT
  USING (auth_user_is_company_member(company_id));

-- INSERT: membro ativo pode dispensar; dismissed_by deve ser o próprio auth.uid()
CREATE POLICY "dismissals_insert"
  ON dashboard_alert_dismissals
  FOR INSERT
  WITH CHECK (
    auth_user_is_company_member(company_id)
    AND dismissed_by = auth.uid()
  );

-- DELETE: quem dispensou pode desfazer (undo); admin da empresa pode desfazer qualquer um
CREATE POLICY "dismissals_delete"
  ON dashboard_alert_dismissals
  FOR DELETE
  USING (
    dismissed_by = auth.uid()
    OR auth_user_is_company_admin(company_id)
  );

-- UPDATE: não permitido — dispensa é imutável; undo = DELETE simples

-- ----------------------------------------------------
-- 5. Configuração de escopo por empresa
-- ----------------------------------------------------
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS alert_dismissal_scope TEXT
  NOT NULL DEFAULT 'company'
  CHECK (alert_dismissal_scope IN ('company', 'user'));

COMMENT ON COLUMN companies.alert_dismissal_scope IS
  'Escopo de dispensa de alertas do dashboard: '
  '"company" = dispensa visível para todos os membros; '
  '"user" = cada usuário gerencia suas próprias dispensas.';
