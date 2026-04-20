-- =============================================================================
-- MIGRATION: Enforcement de storage_mb
--
-- OBJETIVO:
--   Criar a infraestrutura de banco para contabilizar o storage usado por
--   empresa e suportar enforcement de plans.storage_mb.
--
-- O QUE ESTA MIGRATION FAZ:
--
--   1. Adiciona coluna media_file_size (BIGINT, NULL) em chat_messages
--      para rastrear o tamanho de mídias inbound de WhatsApp.
--      NULL indica que o tamanho ainda não foi capturado — não conta no total.
--      O campo é populado de forma assíncrona pelo webhook, sem bloquear ingestão.
--
--   2. Cria índice parcial em chat_messages(company_id) WHERE media_file_size IS NOT NULL
--      para garantir performance do SUM sem impactar o fluxo de mensagens.
--
--   3. Cria função get_company_storage_used_mb(p_company_id UUID)
--      que retorna o total de storage usado (em MB) somando:
--        - lead_media_unified   → mídias de leads (uploads deliberados + chat S3)
--        - company_media_library → biblioteca de mídia da empresa
--        - chat_messages.media_file_size → mídias inbound de WhatsApp (quando capturadas)
--
-- UNIDADE:
--   file_size e media_file_size estão em BYTES.
--   A função retorna NUMERIC em MEGABYTES (÷ 1048576).
--
-- COMPORTAMENTO:
--   - plans.storage_mb = NULL → ilimitado (verificado no backend, não aqui)
--   - media_file_size  = NULL → não contabilizado (COALESCE → 0)
--   - SECURITY DEFINER permite acesso às tabelas sem depender da sessão RLS
-- =============================================================================

-- 1. Coluna para rastrear tamanho de mídia inbound de WhatsApp
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS media_file_size BIGINT NULL;

COMMENT ON COLUMN public.chat_messages.media_file_size IS
  'Tamanho em bytes da mídia inbound de WhatsApp. NULL = não capturado ainda. '
  'Populado de forma assíncrona pelo webhook. Não bloqueia ingestão de mensagens.';

-- 2. Índice parcial para SUM eficiente (não impacta linhas sem mídia)
CREATE INDEX IF NOT EXISTS idx_chat_messages_company_media_size
  ON public.chat_messages(company_id)
  WHERE media_file_size IS NOT NULL;

-- 3. Função de cálculo de storage total por empresa
CREATE OR REPLACE FUNCTION public.get_company_storage_used_mb(p_company_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      -- Mídias de leads (uploads deliberados + arquivos organizados)
      SELECT COALESCE(SUM(file_size), 0)
      FROM public.lead_media_unified
      WHERE company_id = p_company_id
    )
    +
    (
      -- Biblioteca de mídia da empresa
      SELECT COALESCE(SUM(file_size), 0)
      FROM public.company_media_library
      WHERE company_id = p_company_id
    )
    +
    (
      -- Mídias inbound de WhatsApp (quando capturadas pelo webhook)
      -- Usa índice parcial idx_chat_messages_company_media_size
      SELECT COALESCE(SUM(media_file_size), 0)
      FROM public.chat_messages
      WHERE company_id = p_company_id
        AND media_file_size IS NOT NULL
    ),
    0
  ) / 1048576.0
$$;

COMMENT ON FUNCTION public.get_company_storage_used_mb(UUID) IS
  'Retorna o storage total usado pela empresa em MB. '
  'Soma: lead_media_unified + company_media_library + chat_messages (media_file_size). '
  'file_size e media_file_size em bytes. NULL em media_file_size = não contabilizado. '
  'Usar para enforcement de plans.storage_mb no backend.';
