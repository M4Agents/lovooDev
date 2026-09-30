-- =============================================================================
-- Migration: alter_meta_messages_add_template_buttons
-- Timestamp: 20260930120000
--
-- Objetivo:
--   Preparar persistência de snapshot histórico sanitizado de botões
--   de template Meta em public.meta_messages (MVP4C.4).
--
-- Operação (estritamente aditiva):
--   1. ADD COLUMN template_buttons jsonb NULL
--   2. COMMENT ON COLUMN
--
-- Backward-compatible:
--   - Rows existentes permanecem com template_buttons = NULL.
--   - Sem DEFAULT explícito: NULL implícito.
--   - Writers antigos que omitam a coluna continuam válidos.
--   - Sem backfill.
--
-- Não alterado:
--   - RLS, policies, GRANTs
--   - publication supabase_realtime
--   - REPLICA IDENTITY
--   - RPCs, triggers, índices, CHECK, views
--   - qualquer outra tabela
-- =============================================================================

ALTER TABLE public.meta_messages
  ADD COLUMN template_buttons jsonb NULL;

COMMENT ON COLUMN public.meta_messages.template_buttons IS
'MVP4C.4: snapshot histórico sanitizado de botões de template. '
'NULL = sem snapshot. Nunca armazenar payload QR, Graph components '
'ou parameter_values cru.';
