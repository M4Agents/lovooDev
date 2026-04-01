-- =====================================================
-- MIGRATION: idx_chat_conv_contact_company_last
-- Data: 02/04/2026
-- Objetivo: Índice para otimizar a LATERAL JOIN que busca
--           a conversa mais recente por contato na RPC
--           get_funnel_positions_with_photos.
-- Impacto: Elimina seq scan em chat_conversations para cada
--          lead retornado no funil. Criado com CONCURRENTLY
--          para não bloquear operações em produção.
-- =====================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chat_conv_contact_company_last
  ON chat_conversations (contact_phone, company_id, last_message_at DESC NULLS LAST);
