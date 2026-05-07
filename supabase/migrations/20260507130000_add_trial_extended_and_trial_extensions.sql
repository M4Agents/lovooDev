-- =============================================================================
-- Migration: add_trial_extended_and_trial_extensions
-- Data: 2026-05-07
--
-- Problema:
--   Coluna trial_extended e tabela trial_extensions estavam planejadas
--   nas funções create_client_company_with_admin_safe, create_client_company_safe
--   e extend_company_trial, mas nunca foram aplicadas neste ambiente.
--
-- O que esta migration faz:
--   1. Adiciona company_subscriptions.trial_extended (boolean, default false)
--   2. Cria tabela trial_extensions com RLS mínimo
--
-- O que esta migration NÃO faz:
--   ✗ NÃO altera dados existentes
--   ✗ NÃO altera RLS de outras tabelas
--   ✗ NÃO altera funções existentes
-- =============================================================================

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. COLUNA trial_extended EM company_subscriptions
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS trial_extended boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_subscriptions.trial_extended IS
  'Indica se o trial desta empresa já foi estendido uma vez. '
  'Apenas 1 extensão de 14 dias é permitida por empresa.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. TABELA trial_extensions
--    Auditoria de extensões de trial. Usada por extend_company_trial().
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.trial_extensions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid        NOT NULL REFERENCES public.companies(id)  ON DELETE CASCADE,
  extended_by  uuid                    REFERENCES auth.users(id)     ON DELETE SET NULL,
  extended_at  timestamptz NOT NULL DEFAULT now(),
  original_end timestamptz,
  new_end      timestamptz NOT NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trial_extensions_company_id_idx
  ON public.trial_extensions (company_id);

COMMENT ON TABLE public.trial_extensions IS
  'Registro de auditoria de extensões de trial. '
  'Cada linha representa uma extensão de 14 dias concedida por super_admin ou system_admin da empresa pai.';

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.trial_extensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trial_extensions: platform admins only"
  ON public.trial_extensions
  FOR ALL
  USING (auth_user_is_platform_admin());
