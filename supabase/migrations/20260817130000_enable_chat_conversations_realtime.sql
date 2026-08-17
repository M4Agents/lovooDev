-- =============================================================================
-- Habilitar Supabase Realtime para chat_conversations
-- =============================================================================
-- Arquivo: 20260817130000_enable_chat_conversations_realtime.sql
--
-- Problema:
--   chat_conversations NÃO estava na publicação supabase_realtime, portanto
--   o trigger update_conversation_last_message() atualizava last_message_at,
--   last_message_content e last_message_direction — mas o frontend nunca
--   recebia o evento. Resultado: sidebar não reordenava conversas nem
--   atualizava o preview da última mensagem em tempo real.
--
--   Adicionalmente, ambas as tabelas tinham REPLICA IDENTITY DEFAULT (somente
--   PK), o que impede que filtros por company_id funcionem corretamente em
--   eventos de UPDATE — o Supabase Realtime exige FULL para colunas não-PK.
--
-- Correção:
--   1. REPLICA IDENTITY FULL em chat_conversations e chat_messages
--      → garante payload completo em UPDATE/DELETE com filtro por company_id
--   2. ADD TABLE chat_conversations à publicação supabase_realtime
--      → passa a entregar eventos de INSERT/UPDATE/DELETE para o frontend
--
-- Risco: Baixo
--   • Sem impacto em queries, RPCs, RLS ou schema
--   • Apenas habilita o canal de entrega de eventos já subscrito pelo frontend
-- =============================================================================

-- 1. Garantir payload completo para filtros por company_id
ALTER TABLE public.chat_conversations REPLICA IDENTITY FULL;
ALTER TABLE public.chat_messages      REPLICA IDENTITY FULL;

-- 2. Adicionar chat_conversations ao canal de realtime
--    (chat_messages já estava na publicação)
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
