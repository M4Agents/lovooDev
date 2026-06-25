-- =====================================================
-- ROLLBACK: 20260625170000_add_avatar_to_instagram_comments
-- Data: 25/06/2026
-- Objetivo: Remover coluna ig_user_avatar de instagram_comments.
-- =====================================================

ALTER TABLE instagram_comments
  DROP COLUMN IF EXISTS ig_user_avatar;
