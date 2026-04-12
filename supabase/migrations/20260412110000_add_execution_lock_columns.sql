-- =====================================================
-- Migration: add execution lock columns
--
-- Adiciona locked_at e locked_by em automation_executions
-- para suporte ao mecanismo de lock atômico no executor backend.
--
-- O lock é adquirido via UPDATE atômico com condição:
--   WHERE locked_at IS NULL OR locked_at < now() - TTL
--
-- TTL padrão: 10 minutos (definido no executionLock.js)
-- =====================================================

ALTER TABLE public.automation_executions
  ADD COLUMN IF NOT EXISTS locked_at  timestamptz  NULL,
  ADD COLUMN IF NOT EXISTS locked_by  varchar(100) NULL;

-- Índice para identificação de execuções travadas (debug / cleanup)
CREATE INDEX IF NOT EXISTS idx_ae_locked_at
  ON public.automation_executions (locked_at)
  WHERE locked_at IS NOT NULL;
