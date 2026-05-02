-- =====================================================
-- Migration: add_dashboard_insight_customization_feature_flag
--
-- Documenta a nova feature flag dashboard_insight_customization_enabled
-- na coluna plans.features (JSONB).
--
-- Nenhuma alteração de schema necessária — features já é JSONB.
-- Esta migration apenas atualiza o COMMENT da coluna para manter
-- o catálogo de feature flags documentado.
-- =====================================================

COMMENT ON COLUMN public.plans.features IS
  'Features booleanas do plano. Objeto JSONB com chaves no padrão snake_case_enabled. '
  'Ausência da chave = false. Backend: COALESCE((features->>''chave'')::boolean, false). '
  'Chaves definidas: '
  'opportunity_items_enabled, '
  'multiple_agents_enabled, '
  'follow_up_agent_enabled, '
  'scheduling_agent_enabled, '
  'cycle_report_enabled, '
  'advanced_debug_logs_enabled, '
  'dashboard_insight_customization_enabled.';
