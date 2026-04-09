-- =====================================================
-- MIGRATION: Criar tabela agent_processed_messages
-- Data: 2026-04-09
-- Etapa: 7/13
--
-- Propósito:
--   Deduplicação de mensagens processadas pelo agente de IA.
--   Previne que a mesma mensagem do WhatsApp seja processada duas vezes,
--   mesmo em caso de retentativas do webhook ou execuções paralelas.
--
-- Contexto (Etapa 0):
--   A RPC process_webhook_message_safe NÃO possui deduplicação nativa
--   de uazapi_message_id. Esta tabela preenche essa lacuna especificamente
--   para mensagens que precisam de processamento do agente de IA.
--   Não substitui deduplicação de registro de mensagens — apenas de execução do agente.
--
-- Funcionamento:
--   1. Ao receber evento, o Orchestrator verifica se message_id já existe
--   2. Se existir: descartar silenciosamente (idempotência)
--   3. Se não existir: INSERT e prosseguir com o processamento
--   4. O uazapi_message_id é o identificador externo único da mensagem
--
-- Acesso:
--   Exclusivamente via service_role (backend).
--   RLS habilitado sem policies → sem acesso autenticado.
--
-- Retenção:
--   Registros podem ser purgados após N dias sem impacto funcional.
--   O risco de reprocessar uma mensagem muito antiga é aceitável.
--
-- Dependências: Nenhuma.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.agent_processed_messages (
  -- Identificador externo do WhatsApp/Uazapi — chave de deduplicação
  uazapi_message_id     TEXT          PRIMARY KEY,

  -- Contexto de onde a mensagem foi processada
  conversation_id       UUID          NULL
    REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  company_id            UUID          NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Qual assignment processou esta mensagem
  -- NULL se o Orchestrator identificou a mensagem mas não encontrou assignment
  assignment_id         UUID          NULL
    REFERENCES public.company_agent_assignments(id) ON DELETE SET NULL,

  -- Resultado do processamento para auditoria
  -- 'processed': agente executou e respondeu
  -- 'skipped_no_rule': nenhuma regra de roteamento encontrada
  -- 'skipped_ai_inactive': ai_state != 'ai_active'
  -- 'skipped_lock_busy': lock de processamento ocupado
  -- 'error': erro durante o processamento
  result                TEXT          NOT NULL DEFAULT 'processed'
                          CHECK (result IN (
                            'processed',
                            'skipped_no_rule',
                            'skipped_ai_inactive',
                            'skipped_lock_busy',
                            'error'
                          )),

  -- Timestamp para análise de volume e limpeza por TTL
  processed_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Índice para limpeza por TTL e análise temporal
CREATE INDEX IF NOT EXISTS idx_processed_messages_at
  ON public.agent_processed_messages (company_id, processed_at DESC);

-- Índice para queries de auditoria por conversa
CREATE INDEX IF NOT EXISTS idx_processed_messages_conversation
  ON public.agent_processed_messages (conversation_id, processed_at DESC)
  WHERE conversation_id IS NOT NULL;

-- ── RLS: BLOQUEIO TOTAL para acesso autenticado ───────────────────────────────
--
-- Acesso exclusivo via service_role (backend).
-- Nenhuma policy = nenhum acesso autenticado via JWT.

ALTER TABLE public.agent_processed_messages ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy criada intencionalmente.

COMMENT ON TABLE public.agent_processed_messages IS
  'Registro de deduplicação de mensagens processadas pelo agente de IA. '
  'O uazapi_message_id é a chave primária — garante idempotência do processamento. '
  'Verificado pelo Orchestrator antes de qualquer execução de agente. '
  'Acesso exclusivo via service_role — RLS sem policies bloqueia frontend. '
  'Pode ser purgado periodicamente (ex: >30 dias) sem impacto funcional.';

COMMENT ON COLUMN public.agent_processed_messages.uazapi_message_id IS
  'Identificador único da mensagem no Uazapi/WhatsApp. '
  'É a chave de deduplicação: se já existe, o agente não processa novamente.';

COMMENT ON COLUMN public.agent_processed_messages.result IS
  'Resultado do processamento: '
  'processed = agente executou. '
  'skipped_* = descartado por razão específica. '
  'error = falha durante execução.';
