-- =============================================================================
-- Migration: Expandir chat_messages.content de VARCHAR(500) para TEXT
-- Data: 2026-05-23
--
-- Objetivo:
--   Remover limitação de 500 caracteres da coluna content de chat_messages,
--   permitindo mensagens completas (templates longos, resumos de IA, etc.)
--   sem truncamento. Dados existentes são preservados integralmente.
--
-- Segurança:
--   - ALTER COLUMN TYPE TEXT é uma operação segura no PostgreSQL quando o
--     novo tipo é mais permissivo (VARCHAR → TEXT).
--   - Nenhum dado existente é alterado, apenas o constraint de comprimento é
--     removido.
--   - Sem downtime: PostgreSQL faz a conversão implícita sem lock prolongado.
--
-- Contexto:
--   A RPC chat_create_message já usa p_content TEXT internamente.
--   O limite era apenas na coluna da tabela, forçando truncamento manual
--   no frontend (chatApi.ts) que causava inconsistência UI ≠ Banco ≠ WhatsApp.
-- =============================================================================

ALTER TABLE public.chat_messages
  ALTER COLUMN content TYPE TEXT;

-- Confirma a mudança (útil para validação pós-migration)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_schema = 'public'
      AND  table_name   = 'chat_messages'
      AND  column_name  = 'content'
      AND  data_type    = 'text'
  ) THEN
    RAISE NOTICE 'OK: chat_messages.content agora é TEXT';
  ELSE
    RAISE EXCEPTION 'FALHA: chat_messages.content não é TEXT após a migration';
  END IF;
END;
$$;
