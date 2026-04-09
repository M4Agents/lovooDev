-- =====================================================
-- MIGRATION: Adicionar campos de IA em chat_messages
-- Data: 2026-04-09
-- Etapa: 2/13
--
-- Propósito:
--   Adicionar rastreabilidade de mensagens geradas pelo agente de IA.
--   Todos os campos são aditivos (ADD COLUMN) e não afetam linhas existentes.
--
-- Campos adicionados:
--   is_ai_generated  — flag booleana; false para todas as linhas existentes (DEFAULT)
--   ai_run_id        — UUID da execução do agente (liga à ai_agent_execution_logs.id)
--   ai_block_index   — índice do bloco no ResponseComposer (0-based, pós-MVP multi-bloco)
--   ai_block_type    — tipo do bloco: 'text', 'media', 'question', 'cta', 'handoff_notice'
--
-- Compatibilidade retroativa:
--   DEFAULT false em is_ai_generated → todas as mensagens existentes ficam marcadas como human
--   Demais campos são NULL → sem impacto em nenhum INSERT ou SELECT existente
--   Os 2 overloads de chat_get_messages serão atualizados nas migrations 12 e 13
--   para incluir esses campos no jsonb_build_object.
--
-- Dependências: Nenhuma.
-- Rollback snapshot: .snapshots/pre-mvp-agents-20260409/
-- =====================================================

-- is_ai_generated: NOT NULL com DEFAULT false — backfilla todas as linhas existentes
-- O DEFAULT false é mantido permanentemente para futuros INSERTs sem o campo
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT false;

-- ai_run_id: UUID da execução em ai_agent_execution_logs
-- Sem FK intencional — logs devem sobreviver à deleção do histórico de chat
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS ai_run_id UUID NULL;

-- ai_block_index: posição do bloco na resposta composta (pós-MVP)
-- NULL para mensagens humanas e para MVP de bloco único
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS ai_block_index SMALLINT NULL;

-- ai_block_type: categoria semântica do bloco
-- Valores esperados: 'text', 'media', 'question', 'cta', 'handoff_notice'
-- TEXT sem CHECK constraint — flexibilidade para novos tipos sem migration
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS ai_block_type TEXT NULL;

-- Índice para queries de observabilidade e auditoria de mensagens de IA
-- Parcial (WHERE is_ai_generated = true) — footprint mínimo para mensagens humanas
CREATE INDEX IF NOT EXISTS idx_chat_messages_ai_generated
  ON public.chat_messages (company_id, conversation_id, created_at DESC)
  WHERE is_ai_generated = true;

-- Índice para rastrear todos os blocos de uma execução específica
CREATE INDEX IF NOT EXISTS idx_chat_messages_ai_run_id
  ON public.chat_messages (ai_run_id)
  WHERE ai_run_id IS NOT NULL;

COMMENT ON COLUMN public.chat_messages.is_ai_generated IS
  'TRUE quando a mensagem foi gerada pelo agente de IA. '
  'FALSE para mensagens humanas (default). '
  'Usado pelo frontend para diferenciar visualmente mensagens do agente.';

COMMENT ON COLUMN public.chat_messages.ai_run_id IS
  'UUID da execução do agente em ai_agent_execution_logs. '
  'NULL para mensagens humanas. '
  'Sem FK intencional — preserva histórico mesmo se logs forem purgados.';

COMMENT ON COLUMN public.chat_messages.ai_block_index IS
  'Índice 0-based do bloco dentro da resposta composta do ResponseComposer. '
  'NULL para mensagens humanas e para MVP (bloco único). '
  'Pós-MVP: permite ordenar múltiplos blocos da mesma execução.';

COMMENT ON COLUMN public.chat_messages.ai_block_type IS
  'Tipo semântico do bloco: text | media | question | cta | handoff_notice. '
  'NULL para mensagens humanas.';
