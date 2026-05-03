-- =====================================================
-- Migration: add_dashboard_ai_analysis_feature_flag
--
-- Adiciona a feature flag dashboard_ai_analysis_enabled em todos os planos.
--
-- Decisão de produto:
--   A flag serve como controle administrativo, não como barreira comercial.
--   A monetização é 100% por consumo de créditos.
--
--   Flag habilitada em TODOS os planos por padrão.
--   Flag desabilitada → botão oculto (controle administrativo).
--   Flag habilitada + créditos → uso livre.
--   Flag habilitada + sem créditos → fluxo de compra inline.
--
-- Dependências:
--   20260430100003_m4_seed_ai_plans_and_plans.sql (planos existentes)
--   20260430100002_m3_add_features_to_plans.sql   (coluna features JSONB)
-- =====================================================

-- Habilitar a flag em todos os planos ativos
-- jsonb_set(..., true) cria a chave se não existir
UPDATE public.plans
SET
  features   = jsonb_set(
                 COALESCE(features, '{}'::jsonb),
                 '{dashboard_ai_analysis_enabled}',
                 'true'::jsonb,
                 true  -- create_missing = true
               ),
  updated_at = now()
WHERE is_active = true;

-- Atualizar COMMENT da coluna para manter catálogo documentado
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
  'dashboard_insight_customization_enabled, '
  'dashboard_ai_analysis_enabled.';
