-- =====================================================
-- MIGRATION: Adicionar campos de controle de IA em chat_conversations
-- Data: 2026-04-09
-- Etapa: 3/13
--
-- Propósito:
--   Permitir que cada conversa tenha estado explícito de IA (ai_state)
--   e rastreabilidade de quem pausou/retomou o agente.
--
-- Campos adicionados:
--   ai_state         — estado atual da IA na conversa (enum)
--   ai_assignment_id — qual configuração de agente está ativa (sem FK — ver abaixo)
--   ai_paused_at     — quando a IA foi pausada por um humano
--   ai_paused_by     — qual usuário pausou (auth.users UUID)
--   ai_resumed_at    — quando a IA foi reativada
--   ai_resumed_by    — qual usuário reativou
--
-- Nota sobre ai_assignment_id sem FK:
--   company_agent_assignments ainda não existe no momento desta migration.
--   A FK seria circular se adicionada aqui. O ConversationRouter valida o
--   vínculo em runtime. A FK pode ser adicionada em migration futura após
--   confirmar estabilidade do schema.
--
-- Compatibilidade retroativa:
--   ai_state NOT NULL DEFAULT 'ai_inactive' → todas as conversas existentes
--   ficam com IA inativa por padrão. O Router ignora conversas com este estado.
--   Demais campos são NULL → nenhum impacto em INSERT/SELECT existente.
--
-- Dependências: Migration 1 (ai_conversation_state enum) deve estar aplicada.
-- =====================================================

-- Estado da IA na conversa — NOT NULL com DEFAULT garante backfill seguro
-- Todas as conversas existentes ficam com 'ai_inactive' (comportamento inalterado)
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS ai_state public.ai_conversation_state
    NOT NULL DEFAULT 'ai_inactive';

-- UUID do company_agent_assignment ativo para esta conversa
-- NULL quando ai_state = 'ai_inactive'
-- Sem FK intencional: evita dependência circular com a migration 4
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS ai_assignment_id UUID NULL;

-- Rastreabilidade de handoff: quando e quem pausou a IA
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS ai_paused_at TIMESTAMPTZ NULL;

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS ai_paused_by UUID NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Rastreabilidade de handoff reverso: quando e quem devolveu para a IA
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS ai_resumed_at TIMESTAMPTZ NULL;

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS ai_resumed_by UUID NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Índice para o Router: busca rápida de conversas com IA ativa por empresa/instância
CREATE INDEX IF NOT EXISTS idx_chat_conv_ai_active
  ON public.chat_conversations (company_id, instance_id, ai_state)
  WHERE ai_state = 'ai_active';

-- Índice para queries de monitoramento: conversas com IA pausada
CREATE INDEX IF NOT EXISTS idx_chat_conv_ai_paused
  ON public.chat_conversations (company_id, ai_paused_at DESC)
  WHERE ai_state = 'ai_paused';

COMMENT ON COLUMN public.chat_conversations.ai_state IS
  'Estado atual da IA nesta conversa. '
  'ai_inactive: sem agente ativo (default para todas as conversas existentes). '
  'ai_active: agente respondendo automaticamente. '
  'ai_paused: humano assumiu, IA silenciosa. '
  'ai_suggested: modo sugestão pós-MVP.';

COMMENT ON COLUMN public.chat_conversations.ai_assignment_id IS
  'UUID de company_agent_assignments em uso nesta conversa. '
  'NULL quando ai_state = ai_inactive. '
  'Sem FK para evitar dependência circular e permitir arquivamento de assignments.';

COMMENT ON COLUMN public.chat_conversations.ai_paused_at IS
  'Timestamp de quando um humano assumiu a conversa (ai_active → ai_paused). '
  'NULL quando ai_state != ai_paused.';

COMMENT ON COLUMN public.chat_conversations.ai_paused_by IS
  'Usuário que executou o handoff humano (assumiu a conversa). '
  'NULL quando ai_state != ai_paused.';

COMMENT ON COLUMN public.chat_conversations.ai_resumed_at IS
  'Timestamp da última vez que a conversa foi devolvida para a IA. '
  'NULL se nunca devolvida.';

COMMENT ON COLUMN public.chat_conversations.ai_resumed_by IS
  'Usuário que devolveu a conversa para a IA. '
  'NULL se nunca devolvida.';
