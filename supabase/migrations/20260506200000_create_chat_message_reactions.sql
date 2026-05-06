-- =====================================================================
-- Migration: Criar tabela chat_message_reactions
-- Data: 2026-05-06
--
-- Objetivo:
--   Persistir reações enviadas via Uazapi /message/react.
--   Cada usuário pode ter no máximo uma reação ativa por mensagem.
--
-- Segurança multi-tenant:
--   company_id + conversation_id obrigatórios em todas as consultas.
--   Nunca confiar somente na FK message_id.
--
-- RLS:
--   Desabilitado na tabela — acesso somente via RPCs SECURITY DEFINER
--   (chat_upsert_reaction, chat_remove_reaction) com validação explícita
--   de company_id + conversation_id, ou via service_role no backend.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.chat_message_reactions (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID         NOT NULL,
  conversation_id   UUID         NOT NULL,
  message_id        UUID         NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  user_id           UUID         NOT NULL,
  emoji             TEXT,                          -- NULL quando removida
  status            TEXT         NOT NULL DEFAULT 'sent',
  provider          TEXT         NOT NULL DEFAULT 'uazapi',
  provider_response JSONB,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  removed_at        TIMESTAMPTZ                   -- NULL = ativa
);

-- Índice principal: queries por empresa + mensagem
CREATE INDEX IF NOT EXISTS idx_chat_reactions_company_message
  ON public.chat_message_reactions (company_id, message_id)
  WHERE removed_at IS NULL;

-- Índice auxiliar: queries por empresa + conversa (listagens, etc.)
CREATE INDEX IF NOT EXISTS idx_chat_reactions_company_conversation
  ON public.chat_message_reactions (company_id, conversation_id)
  WHERE removed_at IS NULL;

-- Unicidade: apenas uma reação ativa por usuário/mensagem/empresa
-- ON CONFLICT utilizado pelo upsert em chat_upsert_reaction
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_reaction_active_per_user_message
  ON public.chat_message_reactions (company_id, message_id, user_id)
  WHERE removed_at IS NULL;

COMMENT ON TABLE public.chat_message_reactions IS
'Reações em mensagens do chat enviadas via Uazapi /message/react. '
'Acesso somente via RPCs SECURITY DEFINER ou backend service_role com validação de company_id + conversation_id.';
