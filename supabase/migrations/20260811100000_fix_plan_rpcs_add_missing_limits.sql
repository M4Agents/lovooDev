-- =============================================================================
-- Migration: fix_plan_rpcs_add_missing_limits
-- Data: 2026-08-11
--
-- Problema:
--   As RPCs create_plan e update_plan não recebiam nem persistiam os 6 campos
--   de limite adicionados em M2 (20260430100001_m2_alter_plans.sql):
--     max_funnels, max_funnel_stages, max_automation_flows,
--     max_automation_executions_monthly, max_products, storage_mb
--
--   Consequência: planos criados/editados pelo painel ignoravam esses campos,
--   deixando-os como NULL (ilimitado) independentemente do que o admin definia.
--   O enforcement de banco (triggers em sales_funnels, automation_flows, products)
--   e o enforcement de API (funnel/create-stage, executor, storage) já existiam e
--   funcionariam corretamente assim que os limites fossem persistidos.
--
-- Problema adicional resolvido nesta migration:
--   Cada iteração anterior das RPCs (20241118, m5/20260430100004, 20260502100001)
--   usou CREATE OR REPLACE com assinaturas distintas, criando overloads em vez de
--   substituir as versões anteriores. Isso resulta em múltiplos overloads no banco
--   que causam ambiguidade no PostgREST (300 Multiple Choices).
--   Esta migration remove todos os overloads antigos antes de criar as versões
--   finais, garantindo UMA única assinatura válida por operação.
--
-- Overloads a remover:
--   create_plan: versão 14-param (20241118 / m5) e versão 15-param (20260502100001)
--   update_plan: versão 15-param (20241118 / m5) e versão 16-param (20260502100001)
--
-- Dependências verificadas:
--   Nenhuma view, trigger, constraint ou outra função cria dependência de catálogo
--   sobre create_plan ou update_plan. DROP sem CASCADE é seguro.
--
-- Grants:
--   As versões anteriores não tinham GRANT/REVOKE explícito (usavam default PUBLIC).
--   Esta migration adota o padrão explícito do projeto (igual a update_plan_ai_credits):
--     REVOKE FROM PUBLIC + GRANT TO authenticated
--   O acesso real não é ampliado — anon nunca tinha acesso funcional (auth interna
--   via auth_user_is_platform_admin()); apenas formaliza a restrição correta.
--
-- Semântica de NULL (confirmada em M2 e limitChecker.js):
--   NULL = ilimitado para todos os campos max_* e storage_mb.
--
-- Padrão de atualização parcial (update_plan):
--   COALESCE(p_campo, campo_atual) — igual ao padrão de max_leads/max_users.
--
-- DÍVIDA TÉCNICA documentada:
--   update_plan usa COALESCE — NULL no parâmetro significa "não alterar", portanto
--   não é possível reverter um limite existente para NULL (ilimitado) via esta RPC.
--   Comportamento pré-existente também para max_leads e max_users.
--
-- O que esta migration NÃO faz:
--   ✗ NÃO usa CASCADE nos DROPs
--   ✗ NÃO altera RLS de nenhuma tabela
--   ✗ NÃO altera triggers existentes
--   ✗ NÃO altera schema de company_subscriptions
--   ✗ NÃO altera admin_set_company_plan
--   ✗ NÃO altera api/plans/available (filtro de is_publicly_listed já está correto)
--   ✗ NÃO altera fluxo Stripe
--   ✗ NÃO altera get_plans_full (já retorna os 6 campos corretamente)
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- ETAPA 1 — Remover overloads antigos de create_plan
--
-- Assinatura 14-param (20241118 / m5 — sem stripe_price_id_monthly):
--   create_plan(varchar, varchar, text, numeric, varchar, varchar,
--               int4, int4, int4, int4, jsonb, bool, bool, int4)
--
-- Assinatura 15-param (20260502100001 — com stripe_price_id_monthly):
--   create_plan(varchar, varchar, text, numeric, varchar, varchar,
--               int4, int4, int4, int4, jsonb, bool, bool, int4, text)
--
-- IF EXISTS garante idempotência se a migration for reaplicada.
-- Sem CASCADE — nenhuma dependência de catálogo identificada.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.create_plan(
  varchar, varchar, text, numeric, varchar, varchar,
  integer, integer, integer, integer,
  jsonb, boolean, boolean, integer
);

DROP FUNCTION IF EXISTS public.create_plan(
  varchar, varchar, text, numeric, varchar, varchar,
  integer, integer, integer, integer,
  jsonb, boolean, boolean, integer, text
);


-- ══════════════════════════════════════════════════════════════════════════════
-- ETAPA 2 — Remover overloads antigos de update_plan
--
-- Assinatura 15-param (20241118 / m5 — sem stripe_price_id_monthly):
--   update_plan(uuid, varchar, varchar, text, numeric, varchar, varchar,
--               int4, int4, int4, int4, jsonb, bool, bool, int4)
--
-- Assinatura 16-param (20260502100001 — com stripe_price_id_monthly):
--   update_plan(uuid, varchar, varchar, text, numeric, varchar, varchar,
--               int4, int4, int4, int4, jsonb, bool, bool, int4, text)
--
-- IF EXISTS garante idempotência se a migration for reaplicada.
-- Sem CASCADE — nenhuma dependência de catálogo identificada.
-- ══════════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.update_plan(
  uuid,
  varchar, varchar, text, numeric, varchar, varchar,
  integer, integer, integer, integer,
  jsonb, boolean, boolean, integer
);

DROP FUNCTION IF EXISTS public.update_plan(
  uuid,
  varchar, varchar, text, numeric, varchar, varchar,
  integer, integer, integer, integer,
  jsonb, boolean, boolean, integer, text
);


-- ══════════════════════════════════════════════════════════════════════════════
-- ETAPA 3 — create_plan — versão final com 21 parâmetros
--
-- Parâmetros adicionados (com DEFAULT NULL = ilimitado na criação):
--   p_max_funnels                    INTEGER DEFAULT NULL
--   p_max_funnel_stages              INTEGER DEFAULT NULL
--   p_max_automation_flows           INTEGER DEFAULT NULL
--   p_max_automation_executions_monthly INTEGER DEFAULT NULL
--   p_max_products                   INTEGER DEFAULT NULL
--   p_storage_mb                     INTEGER DEFAULT NULL
--
-- Autorização: auth_user_is_platform_admin() — SECURITY DEFINER — inalterada.
-- GRANT: REVOKE FROM PUBLIC + GRANT TO authenticated (padrão explícito do projeto).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_plan(
  p_name                               varchar,
  p_slug                               varchar,
  p_description                        text    DEFAULT NULL,
  p_price                              numeric DEFAULT 0,
  p_currency                           varchar DEFAULT 'BRL',
  p_billing_cycle                      varchar DEFAULT 'monthly',
  p_max_whatsapp_instances             integer DEFAULT 1,
  p_max_landing_pages                  integer DEFAULT NULL,
  p_max_leads                          integer DEFAULT NULL,
  p_max_users                          integer DEFAULT NULL,
  p_max_funnels                        integer DEFAULT NULL,
  p_max_funnel_stages                  integer DEFAULT NULL,
  p_max_automation_flows               integer DEFAULT NULL,
  p_max_automation_executions_monthly  integer DEFAULT NULL,
  p_max_products                       integer DEFAULT NULL,
  p_storage_mb                         integer DEFAULT NULL,
  p_features                           jsonb   DEFAULT '{}'::jsonb,
  p_is_active                          boolean DEFAULT true,
  p_is_popular                         boolean DEFAULT false,
  p_sort_order                         integer DEFAULT 0,
  p_stripe_price_id_monthly            text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem criar planos';
  END IF;

  INSERT INTO public.plans (
    name, slug, description, price, currency, billing_cycle,
    max_whatsapp_instances, max_landing_pages, max_leads, max_users,
    max_funnels, max_funnel_stages, max_automation_flows,
    max_automation_executions_monthly, max_products, storage_mb,
    features, is_active, is_popular, sort_order, stripe_price_id_monthly, created_by
  ) VALUES (
    p_name, p_slug, p_description, p_price, p_currency, p_billing_cycle,
    p_max_whatsapp_instances, p_max_landing_pages, p_max_leads, p_max_users,
    p_max_funnels, p_max_funnel_stages, p_max_automation_flows,
    p_max_automation_executions_monthly, p_max_products, p_storage_mb,
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

REVOKE ALL ON FUNCTION public.create_plan(
  varchar, varchar, text, numeric, varchar, varchar,
  integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  jsonb, boolean, boolean, integer, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_plan(
  varchar, varchar, text, numeric, varchar, varchar,
  integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  jsonb, boolean, boolean, integer, text
) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- ETAPA 4 — update_plan — versão final com 22 parâmetros
--
-- Parâmetros adicionados com DEFAULT NULL e COALESCE (padrão do projeto):
--   p_max_funnels, p_max_funnel_stages, p_max_automation_flows,
--   p_max_automation_executions_monthly, p_max_products, p_storage_mb
--
-- Comportamento COALESCE: NULL no parâmetro = "não alterar o campo".
-- Exceção mantida: stripe_price_id_monthly usa CASE (NULL=não altera, ''=limpa).
--
-- DÍVIDA TÉCNICA: não é possível reverter limite para NULL via esta RPC.
-- Comportamento idêntico ao de max_leads e max_users existentes.
--
-- Autorização: auth_user_is_platform_admin() — SECURITY DEFINER — inalterada.
-- GRANT: REVOKE FROM PUBLIC + GRANT TO authenticated (padrão explícito do projeto).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_plan(
  p_plan_id                            uuid,
  p_name                               varchar DEFAULT NULL,
  p_slug                               varchar DEFAULT NULL,
  p_description                        text    DEFAULT NULL,
  p_price                              numeric DEFAULT NULL,
  p_currency                           varchar DEFAULT NULL,
  p_billing_cycle                      varchar DEFAULT NULL,
  p_max_whatsapp_instances             integer DEFAULT NULL,
  p_max_landing_pages                  integer DEFAULT NULL,
  p_max_leads                          integer DEFAULT NULL,
  p_max_users                          integer DEFAULT NULL,
  p_max_funnels                        integer DEFAULT NULL,
  p_max_funnel_stages                  integer DEFAULT NULL,
  p_max_automation_flows               integer DEFAULT NULL,
  p_max_automation_executions_monthly  integer DEFAULT NULL,
  p_max_products                       integer DEFAULT NULL,
  p_storage_mb                         integer DEFAULT NULL,
  p_features                           jsonb   DEFAULT NULL,
  p_is_active                          boolean DEFAULT NULL,
  p_is_popular                         boolean DEFAULT NULL,
  p_sort_order                         integer DEFAULT NULL,
  p_stripe_price_id_monthly            text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas platform admins podem atualizar planos';
  END IF;

  UPDATE public.plans SET
    name                               = COALESCE(p_name,                   name),
    slug                               = COALESCE(p_slug,                   slug),
    description                        = COALESCE(p_description,            description),
    price                              = COALESCE(p_price,                  price),
    currency                           = COALESCE(p_currency,               currency),
    billing_cycle                      = COALESCE(p_billing_cycle,          billing_cycle),
    max_whatsapp_instances             = COALESCE(p_max_whatsapp_instances, max_whatsapp_instances),
    max_landing_pages                  = COALESCE(p_max_landing_pages,      max_landing_pages),
    max_leads                          = COALESCE(p_max_leads,              max_leads),
    max_users                          = COALESCE(p_max_users,              max_users),
    max_funnels                        = COALESCE(p_max_funnels,            max_funnels),
    max_funnel_stages                  = COALESCE(p_max_funnel_stages,      max_funnel_stages),
    max_automation_flows               = COALESCE(p_max_automation_flows,   max_automation_flows),
    max_automation_executions_monthly  = COALESCE(p_max_automation_executions_monthly, max_automation_executions_monthly),
    max_products                       = COALESCE(p_max_products,           max_products),
    storage_mb                         = COALESCE(p_storage_mb,             storage_mb),
    features                           = COALESCE(p_features,               features),
    is_active                          = COALESCE(p_is_active,              is_active),
    is_popular                         = COALESCE(p_is_popular,             is_popular),
    sort_order                         = COALESCE(p_sort_order,             sort_order),
    stripe_price_id_monthly = CASE
      WHEN p_stripe_price_id_monthly IS NULL    THEN stripe_price_id_monthly
      WHEN TRIM(p_stripe_price_id_monthly) = '' THEN NULL
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

REVOKE ALL ON FUNCTION public.update_plan(
  uuid,
  varchar, varchar, text, numeric, varchar, varchar,
  integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  jsonb, boolean, boolean, integer, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_plan(
  uuid,
  varchar, varchar, text, numeric, varchar, varchar,
  integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer,
  jsonb, boolean, boolean, integer, text
) TO authenticated;


DO $$
BEGIN
  RAISE LOG '=== fix_plan_rpcs_add_missing_limits aplicada com sucesso ===';
  RAISE LOG '  DROPS: 2 overloads antigos de create_plan (14-param, 15-param) removidos';
  RAISE LOG '  DROPS: 2 overloads antigos de update_plan (15-param, 16-param) removidos';
  RAISE LOG '  create_plan: versão final 21-param criada (6 novos limites adicionados)';
  RAISE LOG '  update_plan: versão final 22-param criada (6 novos limites adicionados)';
  RAISE LOG '  GRANTS: REVOKE FROM PUBLIC + GRANT TO authenticated em ambas as RPCs';
  RAISE LOG '  DÍVIDA TÉCNICA: update_plan COALESCE impede reverter limite para NULL via RPC';
END;
$$;
