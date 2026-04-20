-- ============================================================
-- M6 — RPCs administrativas novas para nova modelagem
-- Data: 2026-04-30
-- Depende de: M1, M2, M3, M4, M5
--
-- RPCs criadas:
--   1. get_ai_plans_admin()  — lista ai_plans com dados de governança
--   2. create_ai_plan()      — cria ai_plan (platform admin)
--   3. update_ai_plan()      — atualiza ai_plan (platform admin)
--   4. delete_ai_plan()      — desativa ai_plan (soft delete)
--   5. get_plans_full()      — lista plans com JOIN ai_plans + campos completos
--
-- Depreca (mas não remove em M6):
--   - get_plans_governance()  → substituída por get_plans_full()
--   - get_plans()             → substituída por get_plans_full()
--   - update_plan_ai_credits()→ substituída por update_ai_plan()
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. get_ai_plans_admin()
--
-- Lista todos os ai_plans com dados de governança calculados.
-- Inclui estimated_conversations = monthly_credits / 50 (aprox ~50 créditos/conversa).
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_ai_plans_admin();

CREATE OR REPLACE FUNCTION public.get_ai_plans_admin()
RETURNS TABLE (
  id                      UUID,
  name                    VARCHAR,
  slug                    VARCHAR,
  monthly_credits         INTEGER,
  internal_price          DECIMAL,
  is_active               BOOLEAN,
  sort_order              INTEGER,
  estimated_conversations INTEGER,
  plans_count             BIGINT,
  created_at              TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'access_denied'
      USING HINT = 'apenas platform admins podem acessar ai_plans';
  END IF;

  RETURN QUERY
  SELECT
    ap.id,
    ap.name,
    ap.slug,
    ap.monthly_credits,
    ap.internal_price,
    ap.is_active,
    ap.sort_order,
    -- Estimativa: ~50 créditos por conversa (baseado em uso médio com LLM)
    (ap.monthly_credits / NULLIF(50, 0)) AS estimated_conversations,
    -- Quantos plans CRM estão usando este ai_plan
    COUNT(p.id) AS plans_count,
    ap.created_at,
    ap.updated_at
  FROM public.ai_plans ap
  LEFT JOIN public.plans p ON p.ai_plan_id = ap.id
  GROUP BY ap.id
  ORDER BY ap.sort_order ASC, ap.name ASC;
END;
$$;

COMMENT ON FUNCTION public.get_ai_plans_admin() IS
  'Lista todos os planos de IA com dados de governança. '
  'estimated_conversations = monthly_credits / 50. '
  'plans_count = quantos planos CRM estão vinculados a este ai_plan. '
  'Acesso exclusivo para platform admins.';


-- ══════════════════════════════════════════════════════════════
-- 2. create_ai_plan()
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_ai_plan(VARCHAR, VARCHAR, INTEGER, DECIMAL, BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION public.create_ai_plan(
  p_name            VARCHAR,
  p_slug            VARCHAR,
  p_monthly_credits INTEGER  DEFAULT 0,
  p_internal_price  DECIMAL  DEFAULT 0,
  p_is_active       BOOLEAN  DEFAULT true,
  p_sort_order      INTEGER  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem criar planos de IA';
  END IF;

  INSERT INTO public.ai_plans (
    name, slug, monthly_credits, internal_price, is_active, sort_order, created_by
  ) VALUES (
    p_name, p_slug, p_monthly_credits, p_internal_price, p_is_active, p_sort_order, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success',   true,
    'ai_plan_id', v_id,
    'message',   'Plano de IA criado com sucesso'
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Já existe um plano de IA com este nome ou slug');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 3. update_ai_plan()
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.update_ai_plan(UUID, VARCHAR, INTEGER, DECIMAL, BOOLEAN, INTEGER);

CREATE OR REPLACE FUNCTION public.update_ai_plan(
  p_ai_plan_id      UUID,
  p_name            VARCHAR DEFAULT NULL,
  p_monthly_credits INTEGER DEFAULT NULL,
  p_internal_price  DECIMAL DEFAULT NULL,
  p_is_active       BOOLEAN DEFAULT NULL,
  p_sort_order      INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem atualizar planos de IA';
  END IF;

  UPDATE public.ai_plans SET
    name            = COALESCE(p_name,            name),
    monthly_credits = COALESCE(p_monthly_credits, monthly_credits),
    internal_price  = COALESCE(p_internal_price,  internal_price),
    is_active       = COALESCE(p_is_active,       is_active),
    sort_order      = COALESCE(p_sort_order,      sort_order),
    updated_by      = auth.uid()
  WHERE id = p_ai_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plano de IA não encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Plano de IA atualizado com sucesso');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Já existe um plano de IA com este nome');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 4. delete_ai_plan() — soft delete (is_active = false)
--
-- Não remove fisicamente. Desvincula o ai_plan_id dos plans que usam.
-- Plans que perderem o vínculo passarão a ter 0 créditos na renovação.
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.delete_ai_plan(UUID);

CREATE OR REPLACE FUNCTION public.delete_ai_plan(p_ai_plan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plans_count INTEGER;
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem remover planos de IA';
  END IF;

  -- Verificar quantos plans CRM usam este ai_plan
  SELECT COUNT(*) INTO v_plans_count
  FROM public.plans
  WHERE ai_plan_id = p_ai_plan_id;

  IF v_plans_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('%s plano(s) CRM ainda usa(m) este plano de IA. Desvincule primeiro.', v_plans_count)
    );
  END IF;

  -- Soft delete: desativar
  UPDATE public.ai_plans
  SET is_active = false, updated_by = auth.uid()
  WHERE id = p_ai_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plano de IA não encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Plano de IA desativado com sucesso');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 5. get_plans_full()
--
-- Substitui get_plans() e get_plans_governance().
-- Retorna plans CRM com JOIN de ai_plans + todos os limites + features.
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_plans_full();

CREATE OR REPLACE FUNCTION public.get_plans_full()
RETURNS TABLE (
  -- Identificação
  id              UUID,
  name            VARCHAR,
  slug            VARCHAR,
  description     TEXT,
  price           DECIMAL,
  currency        VARCHAR,
  billing_cycle   VARCHAR,
  is_active       BOOLEAN,
  is_popular      BOOLEAN,
  sort_order      INTEGER,
  -- Limites CRM
  max_whatsapp_instances            INTEGER,
  max_leads                         INTEGER,
  max_users                         INTEGER,
  max_landing_pages                 INTEGER,
  max_funnels                       INTEGER,
  max_funnel_stages                 INTEGER,
  max_automation_flows              INTEGER,
  max_automation_executions_monthly INTEGER,
  max_products                      INTEGER,
  storage_mb                        INTEGER,
  -- Features JSONB (objeto completo)
  features        JSONB,
  -- Plano de IA vinculado
  ai_plan_id             UUID,
  ai_plan_name           VARCHAR,
  ai_plan_slug           VARCHAR,
  ai_plan_monthly_credits INTEGER,
  ai_plan_internal_price  DECIMAL,
  -- Governança calculada (somente para platform admin)
  estimated_conversations          INTEGER,
  -- Timestamps
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'access_denied'
      USING HINT = 'apenas platform admins podem acessar get_plans_full';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.slug,
    p.description,
    p.price,
    p.currency,
    p.billing_cycle,
    p.is_active,
    p.is_popular,
    p.sort_order,
    p.max_whatsapp_instances,
    p.max_leads,
    p.max_users,
    p.max_landing_pages,
    p.max_funnels,
    p.max_funnel_stages,
    p.max_automation_flows,
    p.max_automation_executions_monthly,
    p.max_products,
    p.storage_mb,
    p.features,
    ap.id,
    ap.name,
    ap.slug,
    ap.monthly_credits,
    ap.internal_price,
    (ap.monthly_credits / NULLIF(50, 0)) AS estimated_conversations,
    p.created_at,
    p.updated_at
  FROM public.plans p
  LEFT JOIN public.ai_plans ap ON ap.id = p.ai_plan_id
  ORDER BY p.sort_order ASC, p.name ASC;
END;
$$;

COMMENT ON FUNCTION public.get_plans_full() IS
  'Lista plans CRM com JOIN de ai_plans. '
  'Substitui get_plans() e get_plans_governance(). '
  'Inclui todos os limites, features JSONB e dados de governança calculados. '
  'Acesso exclusivo para platform admins.';


-- ══════════════════════════════════════════════════════════════
-- 6. update_plan_with_ai_plan()
--
-- Extensão de update_plan para também setar ai_plan_id.
-- Mantém compatibilidade com update_plan() existente no frontend.
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.update_plan_with_ai_plan(UUID, UUID);

CREATE OR REPLACE FUNCTION public.update_plan_with_ai_plan(
  p_plan_id    UUID,
  p_ai_plan_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem vincular plano de IA';
  END IF;

  -- Verificar se ai_plan existe e está ativo
  IF p_ai_plan_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.ai_plans WHERE id = p_ai_plan_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plano de IA não encontrado ou inativo');
  END IF;

  UPDATE public.plans
  SET ai_plan_id = p_ai_plan_id, updated_by = auth.uid()
  WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plano não encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Plano de IA vinculado com sucesso');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


DO $$
BEGIN
  RAISE LOG 'M6 aplicada:';
  RAISE LOG '  get_ai_plans_admin(): lista ai_plans com governança';
  RAISE LOG '  create_ai_plan(): cria ai_plan com auth correto';
  RAISE LOG '  update_ai_plan(): atualiza ai_plan com auth correto';
  RAISE LOG '  delete_ai_plan(): soft delete de ai_plan';
  RAISE LOG '  get_plans_full(): substitui get_plans() e get_plans_governance()';
  RAISE LOG '  update_plan_with_ai_plan(): vincula ai_plan_id a um plan CRM';
END;
$$;
