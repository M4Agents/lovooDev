-- ============================================================
-- M4 — Seed: ai_plans + plans + UPDATE companies.plan_id
-- Data: 2026-04-30
-- Depende de: M1, M2, M3
--
-- Objetivo:
--   1. Criar os 4 ai_plans oficiais (starter, growth, pro, elite)
--   2. Limpar plans legados (basic, start, professional, enterprise, Básico, Profissional)
--   3. Inserir/atualizar os 4 plans CRM definitivos com slugs oficiais
--   4. Vincular plans.ai_plan_id → ai_plans correspondente
--   5. Atualizar companies.plan_id por lookup de slug
--
-- Nota: em ambiente de desenvolvimento — empresas sem match ficam com plan_id NULL.
-- Isso é aceitável e será resolvido pelo checklist M7.
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. LIMPAR PLANS LEGADOS
--    Remover registros com slugs antigos que não fazem parte
--    do modelo definitivo (starter, growth, pro, elite).
--    "start" e "professional" eram slugs errados; "basic" e "enterprise" são legados.
--    "pro" é mantido pois já era o slug correto.
-- ══════════════════════════════════════════════════════════════

DELETE FROM public.plans
WHERE slug IN ('basic', 'start', 'professional', 'enterprise')
  AND NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.plan_id = public.plans.id
  );

-- Também remover por nome legado caso slug tenha sido alterado manualmente
DELETE FROM public.plans
WHERE name IN ('Básico', 'Profissional')
  AND slug NOT IN ('starter', 'growth', 'pro', 'elite');

-- ══════════════════════════════════════════════════════════════
-- 2. INSERIR AI_PLANS (4 planos oficiais de IA)
--    internal_price = custo estimado OpenAI (governança interna)
--    monthly_credits = cota de créditos de IA por mês
--
-- Estrutura baseada na tabela oficial do plano:
--   Starter: 5.000 créditos  → ~100 conversas
--   Growth:  15.000 créditos → ~300 conversas
--   Pro:     30.000 créditos → ~600 conversas
--   Elite:   100.000 créditos (custom)
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.ai_plans (name, slug, monthly_credits, internal_price, is_active, sort_order)
VALUES
  ('AI Starter',  'ai-starter', 5000,   30.00, true, 1),
  ('AI Growth',   'ai-growth',  15000,  80.00, true, 2),
  ('AI Pro',      'ai-pro',     30000, 150.00, true, 3),
  ('AI Elite',    'ai-elite',  100000, 400.00, true, 4)
ON CONFLICT (slug) DO UPDATE SET
  name            = EXCLUDED.name,
  monthly_credits = EXCLUDED.monthly_credits,
  internal_price  = EXCLUDED.internal_price,
  sort_order      = EXCLUDED.sort_order,
  updated_at      = now();

-- ══════════════════════════════════════════════════════════════
-- 3. INSERIR/ATUALIZAR PLANS CRM (4 planos definitivos)
--
-- Limites baseados na tabela oficial:
--   Starter: users=2, leads=5k, whatsapp=3, funnels=2, stages=5, automations=2, execs=5k, products=20, storage=500MB
--   Growth:  users=5, leads=15k, whatsapp=5, funnels=10, stages=15, automations=10, execs=30k, products=100, storage=1024MB
--   Pro:     users=15, leads=30k, whatsapp=10, funnels=20, stages=25, automations=30, execs=100k, products=300, storage=5120MB
--   Elite:   todos NULL (ilimitado/custom)
--
-- Features JSONB com sufixo _enabled:
--   opportunity_items_enabled: Produtos/Serviços visíveis nos items
--   multiple_agents_enabled: múltiplos agentes de IA
--   follow_up_agent_enabled: agente de follow-up
--   scheduling_agent_enabled: agente de agendamento
--   cycle_report_enabled: relatório de ciclo de vendas
--   advanced_debug_logs_enabled: logs avançados de debug
-- ══════════════════════════════════════════════════════════════

INSERT INTO public.plans (
  name, slug, description, price, currency, billing_cycle,
  max_whatsapp_instances, max_leads, max_users,
  max_funnels, max_funnel_stages,
  max_automation_flows, max_automation_executions_monthly,
  max_products, storage_mb,
  features, is_active, is_popular, sort_order
)
VALUES
  (
    'Starter', 'starter',
    'Ideal para pequenos negócios que estão começando.',
    347.00, 'BRL', 'monthly',
    3, 5000, 2,
    2, 5,
    2, 5000,
    20, 512,
    jsonb_build_object(
      'opportunity_items_enabled',  true,
      'multiple_agents_enabled',    false,
      'follow_up_agent_enabled',    false,
      'scheduling_agent_enabled',   false,
      'cycle_report_enabled',       false,
      'advanced_debug_logs_enabled',false
    ),
    true, false, 1
  ),
  (
    'Growth', 'growth',
    'Para empresas em crescimento acelerado.',
    697.00, 'BRL', 'monthly',
    5, 15000, 5,
    10, 15,
    10, 30000,
    100, 1024,
    jsonb_build_object(
      'opportunity_items_enabled',  true,
      'multiple_agents_enabled',    true,
      'follow_up_agent_enabled',    true,
      'scheduling_agent_enabled',   true,
      'cycle_report_enabled',       true,
      'advanced_debug_logs_enabled',false
    ),
    true, true, 2
  ),
  (
    'Pro', 'pro',
    'Para equipes que precisam de escala e recursos avançados.',
    1097.00, 'BRL', 'monthly',
    10, 30000, 15,
    20, 25,
    30, 100000,
    300, 5120,
    jsonb_build_object(
      'opportunity_items_enabled',  true,
      'multiple_agents_enabled',    true,
      'follow_up_agent_enabled',    true,
      'scheduling_agent_enabled',   true,
      'cycle_report_enabled',       true,
      'advanced_debug_logs_enabled',true
    ),
    true, false, 3
  ),
  (
    'Elite', 'elite',
    'Solução completa e personalizada para grandes operações.',
    NULL, 'BRL', 'monthly',
    NULL, NULL, NULL,
    NULL, NULL,
    NULL, NULL,
    NULL, NULL,
    jsonb_build_object(
      'opportunity_items_enabled',  true,
      'multiple_agents_enabled',    true,
      'follow_up_agent_enabled',    true,
      'scheduling_agent_enabled',   true,
      'cycle_report_enabled',       true,
      'advanced_debug_logs_enabled',true
    ),
    true, false, 4
  )
ON CONFLICT (slug) DO UPDATE SET
  name                               = EXCLUDED.name,
  description                        = EXCLUDED.description,
  price                              = EXCLUDED.price,
  max_whatsapp_instances             = EXCLUDED.max_whatsapp_instances,
  max_leads                          = EXCLUDED.max_leads,
  max_users                          = EXCLUDED.max_users,
  max_funnels                        = EXCLUDED.max_funnels,
  max_funnel_stages                  = EXCLUDED.max_funnel_stages,
  max_automation_flows               = EXCLUDED.max_automation_flows,
  max_automation_executions_monthly  = EXCLUDED.max_automation_executions_monthly,
  max_products                       = EXCLUDED.max_products,
  storage_mb                         = EXCLUDED.storage_mb,
  features                           = EXCLUDED.features,
  is_active                          = EXCLUDED.is_active,
  is_popular                         = EXCLUDED.is_popular,
  sort_order                         = EXCLUDED.sort_order,
  updated_at                         = now();

-- ══════════════════════════════════════════════════════════════
-- 4. VINCULAR plans.ai_plan_id → ai_plans por slug correspondente
-- ══════════════════════════════════════════════════════════════

UPDATE public.plans p
SET ai_plan_id = ap.id
FROM public.ai_plans ap
WHERE ap.slug = 'ai-' || p.slug
  AND p.slug IN ('starter', 'growth', 'pro', 'elite');

-- ══════════════════════════════════════════════════════════════
-- 5. ATUALIZAR companies.plan_id por lookup de slug legado
--
-- Mapeamento de slugs legados → slugs novos:
--   basic       → starter
--   start       → starter
--   professional→ growth
--   enterprise  → elite
--   pro, starter, growth, elite → mantém mapeamento direto
--
-- Empresas sem match ficam com plan_id NULL (aceitável em dev).
-- ══════════════════════════════════════════════════════════════

UPDATE public.companies c
SET plan_id = p.id
FROM public.plans p
WHERE p.slug = CASE
    WHEN c.plan = 'basic'        THEN 'starter'
    WHEN c.plan = 'start'        THEN 'starter'
    WHEN c.plan = 'professional' THEN 'growth'
    WHEN c.plan = 'enterprise'   THEN 'elite'
    ELSE c.plan  -- 'starter', 'growth', 'pro', 'elite' → direto
  END
  AND c.plan_id IS NULL;

-- ══════════════════════════════════════════════════════════════
-- 6. LOG: relatório do resultado do seed
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_ai_plans_count   INTEGER;
  v_plans_count      INTEGER;
  v_companies_linked INTEGER;
  v_companies_null   INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_ai_plans_count   FROM public.ai_plans WHERE slug IN ('ai-starter','ai-growth','ai-pro','ai-elite');
  SELECT COUNT(*) INTO v_plans_count      FROM public.plans    WHERE slug IN ('starter','growth','pro','elite');
  SELECT COUNT(*) INTO v_companies_linked FROM public.companies WHERE plan_id IS NOT NULL;
  SELECT COUNT(*) INTO v_companies_null   FROM public.companies WHERE plan_id IS NULL;

  RAISE LOG 'M4 aplicada:';
  RAISE LOG '  ai_plans criados/atualizados: %', v_ai_plans_count;
  RAISE LOG '  plans CRM criados/atualizados: %', v_plans_count;
  RAISE LOG '  companies com plan_id vinculado: %', v_companies_linked;
  RAISE LOG '  companies com plan_id NULL (sem match): %', v_companies_null;
END;
$$;
