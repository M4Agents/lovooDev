-- =====================================================
-- MIGRATION: Criar enum ai_conversation_state
-- Data: 2026-04-09
-- Etapa: 1/13 — Pré-requisito para todas as migrations que usam ai_state
--
-- Propósito:
--   Tipo enumerado que controla o estado da IA em cada conversa.
--   Centraliza os valores válidos no banco, evitando strings soltas.
--
-- Dependências:
--   Nenhuma — deve ser a primeira migration da Etapa 1.
--
-- Rollback:
--   DROP TYPE public.ai_conversation_state;
--   (Só possível se nenhuma tabela/coluna referenciar o tipo.)
-- =====================================================

-- Verifica se o tipo já existe antes de criar
-- (segurança para re-execução em dev)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typname = 'ai_conversation_state'
      AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.ai_conversation_state AS ENUM (
      'ai_inactive',   -- IA desativada para esta conversa (default)
      'ai_active',     -- IA respondendo automaticamente
      'ai_paused',     -- Humano assumiu a conversa; IA silenciosa
      'ai_suggested'   -- IA sugere resposta, humano decide enviar (pós-MVP)
    );

    COMMENT ON TYPE public.ai_conversation_state IS
      'Estado de controle da IA em chat_conversations. '
      'ai_inactive = sem agente configurado. '
      'ai_active = resposta automática habilitada. '
      'ai_paused = humano assumiu (IA para). '
      'ai_suggested = sugestão sem auto-envio (pós-MVP).';
  END IF;
END $$;
