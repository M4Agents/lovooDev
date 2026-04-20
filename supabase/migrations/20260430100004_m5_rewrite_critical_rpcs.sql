-- ============================================================
-- M5 — Reescrever RPCs críticas para nova modelagem
-- Data: 2026-04-30
-- Depende de: M1, M2, M3, M4
--
-- RPCs alteradas:
--   1. renew_company_credits       — JOIN duplo: companies → plans → ai_plans
--   2. check_whatsapp_life_plan_limit — lê plans.max_whatsapp_instances via plan_id
--   3. company_has_opportunity_items_entitlement — JSONB plans.features
--   4. get_opportunity_items_entitlement          — JSONB plans.features
--   5. create_plan / update_plan / delete_plan    — auth → auth_user_is_platform_admin()
--
-- Padrão de auth obrigatório:
--   USAR:   auth_user_is_platform_admin()
--   BANIDO: companies.is_super_admin
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- 1. renew_company_credits
--
-- ANTES: companies.plan (slug) → plans.monthly_ai_credits
-- AGORA: companies.plan_id → plans.ai_plan_id → ai_plans.monthly_credits
--
-- Comportamento por cenário de NULL:
--   plan_id IS NULL     → v_plan_credits = 0 + LOG 'no_plan_id'
--   ai_plan_id IS NULL  → v_plan_credits = 0 + LOG 'no_ai_plan_id'
--   monthly_credits = 0 → mantém como 0 (plano configurado mas sem créditos)
--   Empresa inexistente → retorna error 'company_not_found'
--
-- Garantias mantidas:
--   - extra_credits NUNCA é tocado
--   - plan_credits é SUBSTITUÍDO (não somado) — regra de negócio
--   - FOR UPDATE serializa concorrência
--   - Ledger registrado apenas quando renovação ocorre de fato
-- ══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.renew_company_credits(UUID);

CREATE OR REPLACE FUNCTION public.renew_company_credits(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row             public.company_credits%ROWTYPE;
  v_plan_credits    INTEGER;
  v_extra           INTEGER;
  v_bal_after       INTEGER;
  v_next_renewal    TIMESTAMPTZ;
  v_plan_id         UUID;
  v_ai_plan_id      UUID;
  v_credits_source  TEXT;  -- para log/ledger: explica de onde veio o valor
BEGIN

  -- ── 1. JOIN duplo: companies → plans → ai_plans ───────────────────────────
  --
  -- Tenta buscar:
  --   companies.plan_id → plans.id → plans.ai_plan_id → ai_plans.monthly_credits
  --
  -- NULL handling explícito:
  --   Se companies.plan_id IS NULL:  v_plan_credits = 0, source = 'no_plan_id'
  --   Se plans.ai_plan_id IS NULL:   v_plan_credits = 0, source = 'no_ai_plan_id'
  --   Se ai_plans não encontrado:    v_plan_credits = 0, source = 'ai_plan_not_found'
  --   Empresa inexistente:           retorna error 'company_not_found'

  SELECT
    c.plan_id,
    pl.ai_plan_id,
    COALESCE(ap.monthly_credits, 0),
    CASE
      WHEN c.plan_id     IS NULL  THEN 'no_plan_id'
      WHEN pl.ai_plan_id IS NULL  THEN 'no_ai_plan_id'
      WHEN ap.id         IS NULL  THEN 'ai_plan_not_found'
      ELSE                             'ok'
    END
  INTO v_plan_id, v_ai_plan_id, v_plan_credits, v_credits_source
  FROM   public.companies c
  LEFT JOIN public.plans    pl ON pl.id = c.plan_id AND pl.is_active = true
  LEFT JOIN public.ai_plans ap ON ap.id = pl.ai_plan_id AND ap.is_active = true
  WHERE  c.id = p_company_id;

  -- Empresa não existe → erro controlado
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_not_found');
  END IF;

  -- Garantir >= 0 mesmo que COALESCE retorne NULL por algum motivo
  v_plan_credits := GREATEST(COALESCE(v_plan_credits, 0), 0);

  -- Log quando créditos = 0 por ausência de configuração (não é erro de aplicação)
  IF v_credits_source <> 'ok' THEN
    RAISE LOG 'renew_company_credits: company=% credits=0 reason=%',
      p_company_id, v_credits_source;
  END IF;

  -- ── 2. Buscar e travar registro de créditos da empresa ────────────────────
  --
  -- FOR UPDATE serializa chamadas concorrentes para a mesma empresa.

  SELECT * INTO v_row
  FROM   public.company_credits
  WHERE  company_id = p_company_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.company_credits (company_id, plan_credits, extra_credits, plan_credits_total)
    VALUES (p_company_id, 0, 0, 0)
    ON CONFLICT (company_id) DO NOTHING;

    SELECT * INTO v_row
    FROM   public.company_credits
    WHERE  company_id = p_company_id
    FOR UPDATE;
  END IF;

  -- ── 3. Idempotência: verificar se o ciclo atual já foi renovado ───────────
  --
  -- now() < last_renewed_at + 1 month → ciclo ainda ativo → skip

  IF v_row.last_renewed_at IS NOT NULL THEN
    v_next_renewal := v_row.last_renewed_at + INTERVAL '1 month';
    IF now() < v_next_renewal THEN
      RETURN jsonb_build_object(
        'ok',              true,
        'renewed',         false,
        'reason',          'already_renewed_this_cycle',
        'next_renewal_at', v_next_renewal
      );
    END IF;
  END IF;

  -- ── 4. Aplicar renovação ──────────────────────────────────────────────────
  --
  -- plan_credits é SUBSTITUÍDO — saldo anterior descartado (regra de negócio).
  -- extra_credits AUSENTE intencionalmente — nunca alterado.
  -- billing_cycle_anchor definido apenas na primeira renovação (COALESCE).

  UPDATE public.company_credits
  SET
    plan_credits         = v_plan_credits,
    plan_credits_total   = v_plan_credits,
    last_renewed_at      = now(),
    billing_cycle_anchor = COALESCE(billing_cycle_anchor, now()),
    updated_at           = now()
  WHERE company_id = p_company_id;

  SELECT extra_credits INTO v_extra
  FROM   public.company_credits
  WHERE  company_id = p_company_id;

  v_bal_after := v_plan_credits + COALESCE(v_extra, 0);

  -- ── 5. Ledger ─────────────────────────────────────────────────────────────

  INSERT INTO public.credit_transactions (
    company_id,
    type,
    credits,
    balance_after,
    plan_balance_after,
    extra_balance_after,
    feature_type,
    metadata
  ) VALUES (
    p_company_id,
    'plan_renewal',
    v_plan_credits,
    v_bal_after,
    v_plan_credits,
    COALESCE(v_extra, 0),
    NULL,
    jsonb_build_object(
      'plan_credits_total', v_plan_credits,
      'renewed_at',         now(),
      'next_renewal_at',    now() + INTERVAL '1 month',
      'cycle_type',         'billing_cycle_anchor',
      'plan_id',            v_plan_id,
      'ai_plan_id',         v_ai_plan_id,
      'credits_source',     v_credits_source
    )
  );

  -- ── 6. Retorno ────────────────────────────────────────────────────────────

  RETURN jsonb_build_object(
    'ok',              true,
    'renewed',         true,
    'plan_credits',    v_plan_credits,
    'extra_credits',   COALESCE(v_extra, 0),
    'balance_after',   v_bal_after,
    'credits_source',  v_credits_source,
    'plan_id',         v_plan_id,
    'ai_plan_id',      v_ai_plan_id,
    'next_renewal_at', now() + INTERVAL '1 month'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.renew_company_credits(UUID) IS
  'Renova créditos mensais da empresa via JOIN duplo: companies.plan_id → plans.ai_plan_id → ai_plans.monthly_credits. '
  'NULL em plan_id ou ai_plan_id → 0 créditos + log (não é erro de aplicação). '
  'Idempotência: now() < last_renewed_at + 1 month → skip. '
  'plan_credits SUBSTITUÍDO — extra_credits NUNCA tocado. '
  'credits_source no retorno e ledger identifica causa de 0 créditos.';


-- ══════════════════════════════════════════════════════════════
-- 2. check_whatsapp_life_plan_limit
--
-- ANTES: CASE WHEN companies.plan (slug) → hardcoded 1/3/10
-- AGORA: companies.plan_id → plans.max_whatsapp_instances
--        NULL = ilimitado (elite/custom)
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_whatsapp_life_plan_limit(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_limit      INTEGER;   -- NULL = ilimitado
  v_current_count   INTEGER;
  v_plan_slug       TEXT;
  v_plan_id         UUID;
  v_can_add         BOOLEAN;
BEGIN

  -- ── 1. Buscar limite via plan_id → plans.max_whatsapp_instances ───────────
  --
  -- Fallback para slug se plan_id ainda não foi migrado (transição).
  -- NULL em max_whatsapp_instances = ilimitado.

  SELECT
    c.plan_id,
    pl.slug,
    pl.max_whatsapp_instances
  INTO v_plan_id, v_plan_slug, v_plan_limit
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = p_company_id;

  -- Empresa não existe
  IF NOT FOUND THEN
    RETURN jsonb_build_object('canAdd', false, 'error', 'company_not_found');
  END IF;

  -- ── 2. Contar instâncias ativas (ignora soft deleted) ─────────────────────

  SELECT COUNT(*) INTO v_current_count
  FROM public.whatsapp_life_instances
  WHERE company_id = p_company_id
    AND deleted_at IS NULL;

  -- ── 3. Calcular resultado ─────────────────────────────────────────────────
  --
  -- NULL em v_plan_limit = ilimitado → canAdd sempre true
  -- Sem plan_id configurado: limite conservador = 1 (por segurança)

  IF v_plan_id IS NULL THEN
    -- Empresa sem plan_id ainda (transição): limite conservador
    v_plan_limit := 1;
  END IF;

  -- NULL = ilimitado
  IF v_plan_limit IS NULL THEN
    v_can_add := true;
  ELSE
    v_can_add := v_current_count < v_plan_limit;
  END IF;

  RETURN jsonb_build_object(
    'canAdd',        v_can_add,
    'currentCount',  v_current_count,
    'maxAllowed',    v_plan_limit,   -- NULL = ilimitado
    'planSlug',      v_plan_slug,
    'remaining',     CASE
                       WHEN v_plan_limit IS NULL THEN NULL  -- ilimitado
                       ELSE GREATEST(0, v_plan_limit - v_current_count)
                     END
  );
END;
$$;

COMMENT ON FUNCTION public.check_whatsapp_life_plan_limit(UUID) IS
  'Verifica limite de instâncias WhatsApp via companies.plan_id → plans.max_whatsapp_instances. '
  'NULL em max_whatsapp_instances = ilimitado (elite/custom). '
  'Instâncias soft deleted (deleted_at IS NOT NULL) não contam no limite. '
  'Empresa sem plan_id → limite conservador de 1.';


-- ══════════════════════════════════════════════════════════════
-- 3. company_has_opportunity_items_entitlement
--
-- ANTES: companies.opportunity_items_enabled AND plan IN ('pro','enterprise')
-- AGORA: (plans.features->>'opportunity_items_enabled')::boolean via plan_id
--        companies.opportunity_items_enabled como override de admin
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.company_has_opportunity_items_entitlement(p_company_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_feature_enabled  BOOLEAN;
  v_company_override      BOOLEAN;
  v_plan_id               UUID;
BEGIN
  -- Buscar feature do plano + override da empresa
  SELECT
    c.plan_id,
    COALESCE((pl.features->>'opportunity_items_enabled')::boolean, false),
    COALESCE(c.opportunity_items_enabled, false)
  INTO v_plan_id, v_plan_feature_enabled, v_company_override
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Feature habilitada se:
  --   1. O plano da empresa tem opportunity_items_enabled = true (via JSONB), OU
  --   2. Admin habilitou manualmente na empresa (override)
  -- Empresa sem plan_id: apenas override vale
  RETURN v_plan_feature_enabled OR v_company_override;
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 4. get_opportunity_items_entitlement
--
-- Atualizado para incluir plan_id e chave JSONB no retorno.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_opportunity_items_entitlement(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_feature_enabled  BOOLEAN;
  v_company_override      BOOLEAN;
  v_plan_id               UUID;
  v_plan_slug             TEXT;
BEGIN
  IF NOT public.company_user_has_access(p_company_id) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_access');
  END IF;

  SELECT
    c.plan_id,
    pl.slug,
    COALESCE((pl.features->>'opportunity_items_enabled')::boolean, false),
    COALESCE(c.opportunity_items_enabled, false)
  INTO v_plan_id, v_plan_slug, v_plan_feature_enabled, v_company_override
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = p_company_id;

  RETURN jsonb_build_object(
    'allowed',           v_plan_feature_enabled OR v_company_override,
    'plan_id',           v_plan_id,
    'plan_slug',         v_plan_slug,
    'plan_feature_ok',   v_plan_feature_enabled,
    'company_override',  v_company_override
  );
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 5. create_plan / update_plan / delete_plan
--
-- ANTES: companies.is_super_admin (BANIDO)
-- AGORA: auth_user_is_platform_admin() (OBRIGATÓRIO)
--
-- Nota: as assinaturas são mantidas para não quebrar o frontend.
-- Os novos parâmetros de M6 (ai_plan_id, max_*) ficam em RPCs novas.
-- ══════════════════════════════════════════════════════════════

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
  p_sort_order  INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id UUID;
BEGIN
  -- Auth: padrão obrigatório
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem criar planos';
  END IF;

  INSERT INTO public.plans (
    name, slug, description, price, currency, billing_cycle,
    max_whatsapp_instances, max_landing_pages, max_leads, max_users,
    features, is_active, is_popular, sort_order, created_by
  ) VALUES (
    p_name, p_slug, p_description, p_price, p_currency, p_billing_cycle,
    p_max_whatsapp_instances, p_max_landing_pages, p_max_leads, p_max_users,
    p_features, p_is_active, p_is_popular, p_sort_order, auth.uid()
  ) RETURNING id INTO v_plan_id;

  RETURN jsonb_build_object(
    'success', true,
    'plan_id', v_plan_id,
    'message', 'Plano criado com sucesso'
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Já existe um plano com este nome ou slug');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


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
  p_sort_order    INTEGER DEFAULT NULL
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
    updated_by             = auth.uid()
  WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plano não encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Plano atualizado com sucesso');
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Já existe um plano com este nome ou slug');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


CREATE OR REPLACE FUNCTION public.delete_plan(p_plan_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_companies_count INTEGER;
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem deletar planos';
  END IF;

  -- Verificar por plan_id (novo) e por slug (legado)
  SELECT COUNT(*) INTO v_companies_count
  FROM public.companies c
  WHERE c.plan_id = p_plan_id
     OR c.plan = (SELECT slug FROM public.plans WHERE id = p_plan_id);

  IF v_companies_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('%s empresa(s) está(ão) usando este plano', v_companies_count)
    );
  END IF;

  DELETE FROM public.plans WHERE id = p_plan_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Plano não encontrado');
  END IF;

  RETURN jsonb_build_object('success', true, 'message', 'Plano deletado com sucesso');
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 6. Corrigir RLS de plans: substituir is_super_admin legado
-- ══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Super admins can manage plans" ON public.plans;

CREATE POLICY "platform_admin_manage_plans"
  ON public.plans
  FOR ALL
  TO authenticated
  USING  (public.auth_user_is_platform_admin())
  WITH CHECK (public.auth_user_is_platform_admin());

COMMENT ON POLICY "platform_admin_manage_plans" ON public.plans IS
  'Substitui policy legada que usava companies.is_super_admin. '
  'Acesso total exclusivo para super_admin ou system_admin em empresa parent.';


DO $$
BEGIN
  RAISE LOG 'M5 aplicada:';
  RAISE LOG '  renew_company_credits: JOIN duplo companies->plans->ai_plans';
  RAISE LOG '  check_whatsapp_life_plan_limit: lê plans.max_whatsapp_instances via plan_id';
  RAISE LOG '  company_has/get_opportunity_items_entitlement: JSONB plans.features';
  RAISE LOG '  create/update/delete_plan: auth migrado para auth_user_is_platform_admin()';
  RAISE LOG '  plans RLS: policy legada substituída por platform_admin_manage_plans';
END;
$$;
