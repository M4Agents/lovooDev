-- =====================================================
-- Migration: add_playbook_to_funnel_stages
-- Data: 2026-05-12
-- Objetivo: Adicionar campos de playbook de vendas às etapas do funil
--
-- playbook_text: script/roteiro de vendas para a etapa
-- video_link:    link do YouTube associado à etapa
--
-- Ambas nullable — etapas existentes não são afetadas.
-- Sem alteração em RLS, triggers ou constraints existentes.
-- =====================================================

ALTER TABLE funnel_stages
  ADD COLUMN IF NOT EXISTS playbook_text TEXT,
  ADD COLUMN IF NOT EXISTS video_link    TEXT;

COMMENT ON COLUMN funnel_stages.playbook_text IS 'Roteiro/script de vendas para a etapa. Editável apenas por admin, super_admin e system_admin.';
COMMENT ON COLUMN funnel_stages.video_link    IS 'URL do vídeo YouTube associado à etapa. Editável apenas por admin, super_admin e system_admin.';
