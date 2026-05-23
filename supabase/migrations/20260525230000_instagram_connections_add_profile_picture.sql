-- Migration: adiciona coluna profile_picture_url em instagram_connections
-- Nullable para compatibilidade com registros existentes.
-- Preenchida no callback OAuth e atualizada via endpoint sync-photo.

ALTER TABLE instagram_connections
  ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
