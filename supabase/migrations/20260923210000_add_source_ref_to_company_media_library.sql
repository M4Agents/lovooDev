-- =============================================================================
-- Migration: 20260923210000_add_source_ref_to_company_media_library
-- Objetivo:  Suporte a importação idempotente de lead_media_unified
--            para company_media_library (MVP4B — 4B.6D.2)
--
-- Aditiva e isolada:
--   - ADD COLUMN source_ref TEXT NULL (backward-compatible, zero backfill)
--   - UNIQUE INDEX parcial WHERE source_ref IS NOT NULL
--     (permite múltiplos NULL por tenant — PostgreSQL padrão, sem NULLS NOT DISTINCT)
--   - Sem CHECK constraint (design: não limitar fontes futuras)
--   - Sem NOT NULL (registros existentes permanecem com source_ref = NULL)
--   - Sem alteração de RLS, FK, realtime, triggers ou outros sistemas
-- =============================================================================

ALTER TABLE public.company_media_library
  ADD COLUMN source_ref TEXT NULL;

COMMENT ON COLUMN public.company_media_library.source_ref IS
  'Referência de provenance para importações de outras tabelas. Formato: lmu:<uuid> para assets importados de lead_media_unified. NULL para assets criados diretamente nesta tabela.';

CREATE UNIQUE INDEX uq_cml_company_source_ref
  ON public.company_media_library (company_id, source_ref)
  WHERE source_ref IS NOT NULL;
