-- =============================================================================
-- Migration: add_stripe_price_id_to_plan_rpcs
-- Data: 2026-05-02
--
-- Expõe plans.stripe_price_id_monthly (coluna já existente) nas RPCs de admin:
--   1. get_plans_full   → adiciona stripe_price_id_monthly ao retorno
--   2. create_plan      → aceita p_stripe_price_id_monthly opcional
--   3. update_plan      → aceita p_stripe_price_id_monthly opcional
--
-- Segurança:
--   - Todas as RPCs são SECURITY DEFINER restrito a platform admin
--   - O campo NÃO é exposto em api/plans/available.js (usuários finais)
--   - NÃO integra com Stripe ainda — apenas armazena o valor
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. get_plans_full — adiciona stripe_price_id_monthly ao retorno
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_plans_full();

CREATE FUNCTION public.get_plans_full()
RETURNS TABLE(
  id uuid, name character varying, slug character varying, description text,
  price numeric, currency character varying, billing_cycle character varying,
  is_active boolean, is_popular boolean, is_publicly_listed boolean, sort_order integer,
  max_whatsapp_instances integer, max_leads integer, max_users integer, max_landing_pages integer,
  max_funnels integer, max_funnel_stages integer, max_automation_flows integer,
  max_automation_executions_monthly integer, max_products integer, storage_mb integer,
  features jsonb,
  stripe_price_id_monthly text,
  ai_plan_id uuid, ai_plan_name character varying, ai_plan_slug character varying,
  ai_plan_monthly_credits integer, ai_plan_internal_price numeric, estimated_conversations integer,
  created_at timestamp with time zone, updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'access_denied' USING HINT = 'apenas platform admins podem acessar get_plans_full';
  END IF;
  RETURN QUERY
  SELECT
    p.id, p.name, p.slug, p.description, p.price, p.currency, p.billing_cycle,
    p.is_active, p.is_popular, p.is_publicly_listed, p.sort_order,
    p.max_whatsapp_instances, p.max_leads, p.max_users, p.max_landing_pages,
    p.max_funnels, p.max_funnel_stages, p.max_automation_flows,
    p.max_automation_executions_monthly, p.max_products, p.storage_mb,
    p.features,
    p.stripe_price_id_monthly,
    ap.id, ap.name, ap.slug, ap.monthly_credits, ap.internal_price,
    (ap.monthly_credits / NULLIF(50, 0)) AS estimated_conversations,
    p.created_at, p.updated_at
  FROM public.plans p
  LEFT JOIN public.ai_plans ap ON ap.id = p.ai_plan_id
  ORDER BY p.sort_order ASC, p.name ASC;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. create_plan — aceita stripe_price_id_monthly opcional
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_plan(
  p_name        VARCHAR,
  p_slug        VARCHAR,
  p_description TEXT    DEFAULT NULL,
  p_price       DECIMAL DEFAULT 0,
  p_currency    VARCHAR DEFAULT 'BRL',
  p_billing_cycle VARCHAR DEFAULT 'monthly',
  p_max_whatsapp_instances INTEGER DEFAULT 1,
  p_max_landing_pages      INTEGER DEFAULT NULL,
  p_max_leads              INTEGER DEFAULT NULL,
  p_max_users              INTEGER DEFAULT NULL,
  p_features    JSONB   DEFAULT '{}'::jsonb,
  p_is_active   BOOLEAN DEFAULT true,
  p_is_popular  BOOLEAN DEFAULT false,
  p_sort_order  INTEGER DEFAULT 0,
  p_stripe_price_id_monthly TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id UUID;
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem criar planos';
  END IF;

  INSERT INTO public.plans (
    name, slug, description, price, currency, billing_cycle,
    max_whatsapp_instances, max_landing_pages, max_leads, max_users,
    features, is_active, is_popular, sort_order, stripe_price_id_monthly, created_by
  ) VALUES (
    p_name, p_slug, p_description, p_price, p_currency, p_billing_cycle,
    p_max_whatsapp_instances, p_max_landing_pages, p_max_leads, p_max_users,
    p_features, p_is_active, p_is_popular, p_sort_order,
    NULLIF(TRIM(p_stripe_price_id_monthly), ''),
    auth.uid()
  ) RETURNING id INTO v_plan_id;

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', v_plan_id,
    'message', 'Plano criado com sucesso'
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Já existe um plano com este nome, slug ou Stripe Price ID');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. update_plan — aceita stripe_price_id_monthly opcional
--
-- Comportamento intencional (consistente com demais campos):
--   p_stripe_price_id_monthly IS NULL → campo não muda (COALESCE)
--   p_stripe_price_id_monthly = ''    → campo é limpo (NULL)
--   p_stripe_price_id_monthly = 'price_XXX' → campo é atualizado
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_plan(
  p_plan_id       UUID,
  p_name          VARCHAR DEFAULT NULL,
  p_slug          VARCHAR DEFAULT NULL,
  p_description   TEXT    DEFAULT NULL,
  p_price         DECIMAL DEFAULT NULL,
  p_currency      VARCHAR DEFAULT NULL,
  p_billing_cycle VARCHAR DEFAULT NULL,
  p_max_whatsapp_instances INTEGER DEFAULT NULL,
  p_max_landing_pages      INTEGER DEFAULT NULL,
  p_max_leads              INTEGER DEFAULT NULL,
  p_max_users              INTEGER DEFAULT NULL,
  p_features      JSONB   DEFAULT NULL,
  p_is_active     BOOLEAN DEFAULT NULL,
  p_is_popular    BOOLEAN DEFAULT NULL,
  p_sort_order    INTEGER DEFAULT NULL,
  p_stripe_price_id_monthly TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem atualizar planos';
  END IF;

  UPDATE public.plans SET
    name                   = COALESCE(p_name,                   name),
    slug                   = COALESCE(p_slug,                   slug),
    description            = COALESCE(p_description,            description),
    price                  = COALESCE(p_price,                  price),
    currency               = COALESCE(p_currency,               currency),
    billing_cycle          = COALESCE(p_billing_cycle,          billing_cycle),
    max_whatsapp_instances = COALESCE(p_max_whatsapp_instances, max_whatsapp_instances),
    max_landing_pages      = COALESCE(p_max_landing_pages,      max_landing_pages),
    max_leads              = COALESCE(p_max_leads,              max_leads),
    max_users              = COALESCE(p_max_users,              max_users),
    features               = COALESCE(p_features,               features),
    is_active              = COALESCE(p_is_active,              is_active),
    is_popular             = COALESCE(p_is_popular,             is_popular),
    sort_order             = COALESCE(p_sort_order,             sort_order),
    stripe_price_id_monthly = CASE
      WHEN p_stripe_price_id_monthly IS NULL     THEN stripe_price_id_monthly
      WHEN TRIM(p_stripe_price_id_monthly) = ''  THEN NULL
      ELSE TRIM(p_stripe_price_id_monthly)
    END,
    updated_by             = auth.uid()
  WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plano não encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Plano atualizado com sucesso');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Já existe um plano com este nome, slug ou Stripe Price ID');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
