-- ============================================================
-- Fix: Ativar opportunity_items_enabled nas empresas filhas com plano habilitado
--
-- Escopo: empresas filhas com plan_feature_ok = true e opportunity_items_enabled = false
-- Empresas afetadas (confirmado via SELECT antes da execução):
--   - Locadora Obra Fácil      (Growth)
--   - Testes Vox2you - M4      (Growth)
--   - Vox2you Santana          (Growth)
--   - Vox2you Tatuapé          (Growth)
--
-- Não altera: empresas já com opportunity_items_enabled = true
-- Não altera: empresas sem plan_id ou com plano sem o feature flag
-- ============================================================

UPDATE public.companies c
SET
  opportunity_items_enabled = true,
  updated_at                = now()
FROM public.plans pl
WHERE c.plan_id          = pl.id
  AND (pl.features->>'opportunity_items_enabled')::boolean = true
  AND c.opportunity_items_enabled = false
  AND c.deleted_at IS NULL;
