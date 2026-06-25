-- =====================================================
-- MIGRATION: add_avatar_to_instagram_comments
-- Data: 25/06/2026
-- Objetivo: Adicionar coluna ig_user_avatar à tabela instagram_comments
--           para armazenar URL permanente da foto de perfil do comentarista.
--
-- A URL é preenchida de forma assíncrona (fire-and-forget) pelo webhook,
-- após buscar profile_pic na Graph API e fazer upload ao Supabase Storage.
--
-- NULL = foto ainda não carregada ou não disponível (usuário sem foto).
-- =====================================================

ALTER TABLE instagram_comments
  ADD COLUMN IF NOT EXISTS ig_user_avatar TEXT;
