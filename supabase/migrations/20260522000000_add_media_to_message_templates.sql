-- ============================================================
-- Migration: Adicionar suporte a mídia em message_templates
-- Fase 3 — Templates com mídia
-- ============================================================
-- Decisão de storage:
--   Armazenar apenas a S3 key (media_path) no banco.
--   Signed URL gerada sob demanda no frontend no momento de uso.
--   Nunca armazenar URL assinada.
-- ============================================================

-- 1. Adicionar colunas na tabela message_templates

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_type TEXT
    CHECK (media_type IS NULL OR media_type IN ('image', 'video', 'document', 'audio'));

-- 2. Constraint de consistência: media_path e media_type devem ser ambos NULL ou ambos preenchidos

ALTER TABLE public.message_templates
  ADD CONSTRAINT chk_media_consistency
    CHECK (
      (media_path IS NULL AND media_type IS NULL)
      OR
      (media_path IS NOT NULL AND media_type IS NOT NULL)
    );

-- 3. Comentários

COMMENT ON COLUMN public.message_templates.media_path IS
  'S3 key do arquivo de mídia. Nunca armazena URL assinada — signed URL é gerada sob demanda.';

COMMENT ON COLUMN public.message_templates.media_type IS
  'Tipo da mídia: image | video | document | audio. NULL quando não há mídia.';
