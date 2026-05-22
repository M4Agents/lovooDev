-- =====================================================
-- MIGRATION: Adiciona funnel_scope_settings em dashboard_alert_settings
-- Data: 22/05/2026
--
-- Objetivo: permitir que cada empresa configure quais etapas de funil
-- devem gerar alertas de "oportunidade parada" no dashboard.
--
-- Estrutura do JSONB:
--   { "mode": "all" }
--   { "mode": "custom", "stage_ids": ["uuid1", "uuid2"] }
--
-- Constraint:
--   - mode obrigatório: 'all' ou 'custom'
--   - quando mode = 'custom': stage_ids obrigatório e deve ser array
--   - mode = 'custom' sem stage_ids é rejeitado no banco
--
-- Retrocompatibilidade:
--   DEFAULT '{"mode":"all"}' preserva comportamento atual para todas as empresas
--
-- Rollback:
--   ALTER TABLE public.dashboard_alert_settings DROP COLUMN funnel_scope_settings;
-- =====================================================

ALTER TABLE public.dashboard_alert_settings
  ADD COLUMN IF NOT EXISTS funnel_scope_settings JSONB NOT NULL
  DEFAULT '{"mode":"all"}'::jsonb;

-- ADD CONSTRAINT com guarda idempotente via DO block
-- (PostgreSQL não suporta ADD CONSTRAINT IF NOT EXISTS para CHECK constraints)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_funnel_scope_settings'
      AND conrelid = 'public.dashboard_alert_settings'::regclass
  ) THEN
    ALTER TABLE public.dashboard_alert_settings
      ADD CONSTRAINT chk_funnel_scope_settings CHECK (
        jsonb_typeof(funnel_scope_settings) = 'object'
        AND funnel_scope_settings ? 'mode'
        AND (funnel_scope_settings->>'mode') IN ('all', 'custom')
        AND (
          funnel_scope_settings->>'mode' = 'all'
          OR (
            funnel_scope_settings ? 'stage_ids'
            AND jsonb_typeof(funnel_scope_settings->'stage_ids') = 'array'
          )
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.dashboard_alert_settings.funnel_scope_settings IS
'Escopo de funis/etapas para alertas de oportunidade parada. '
'mode=all: todas as etapas (comportamento padrão). '
'mode=custom: filtrar apenas pelas etapas em stage_ids (array de UUIDs).';
