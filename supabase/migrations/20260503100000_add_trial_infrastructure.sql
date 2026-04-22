-- =============================================================================
-- Migration: add_trial_infrastructure
-- Data: 2026-05-03
--
-- Etapa 1 do módulo de Trial para novas empresas.
--
-- O que esta migration faz:
--   1. ALTER company_subscriptions → adiciona trial_extended
--   2. CREATE trial_extensions      → auditoria de extensões de trial
--   3. DOCUMENTA o plano Growth como referência oficial do trial
--      (nenhum dado alterado, apenas validação + log)
--
-- O que esta migration NÃO faz (por design):
--   ✗ NÃO cria trial para empresas existentes
--   ✗ NÃO altera companies.plan_id de nenhuma empresa
--   ✗ NÃO insere registros em company_subscriptions
--   ✗ NÃO altera RPCs existentes
--   ✗ NÃO altera RLS existente (apenas adiciona políticas para nova tabela)
--   ✗ NÃO cria plano técnico 'trial' (trial usa plano Growth existente)
--   ✗ NÃO adiciona status 'expired' (trial expirado usa 'canceled' existente)
--
-- Contexto arquitetural:
--   Trial é 100% interno — sem Stripe durante o trial.
--   Controlado por:
--     company_subscriptions.status = 'trialing'
--     company_subscriptions.trial_start
--     company_subscriptions.trial_end
--     company_subscriptions.trial_extended (novo)
--     stripe_subscription_id IS NULL (distingue trial de subscription Stripe)
--
--   Plano durante trial: Growth (slug='growth') — decisão de produto aprovada.
--   Expiração via cron → company_subscriptions.status = 'canceled'
--                      + companies.plan_id = suspended
--   Extensão: +14 dias, máximo 1x por empresa, apenas super_admin/system_admin.
-- =============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. ALTER company_subscriptions — trial_extended
--
-- Flag de controle: indica se a empresa já usou a extensão de trial.
-- Usada pela RPC extend_company_trial para enforçar o limite de 1 extensão.
-- Histórico detalhado fica em trial_extensions (tabela abaixo).
--
-- Colunas trial_start e trial_end JÁ EXISTEM desde billing_layer_pre_stripe.
-- Não recriar.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.company_subscriptions
  ADD COLUMN IF NOT EXISTS trial_extended BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_subscriptions.trial_extended IS
  'true = empresa já utilizou a extensão de trial de +14 dias. '
  'Usado pela RPC extend_company_trial para bloquear segunda extensão. '
  'Histórico completo da extensão fica em trial_extensions. '
  'Nunca alterar diretamente — apenas via RPC SECURITY DEFINER.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. CREATE trial_extensions
--
-- Auditoria imutável de extensões de trial.
-- Cada linha representa 1 extensão concedida por um admin de plataforma.
-- Sem UPDATE/DELETE para usuários autenticados — apenas INSERT via RPC.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.trial_extensions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Empresa que recebeu a extensão
  company_id    UUID        NOT NULL
                REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Admin que concedeu a extensão (super_admin ou system_admin)
  extended_by   UUID        NOT NULL
                REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- Momento da extensão
  extended_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- trial_end antes da extensão
  original_end  TIMESTAMPTZ NOT NULL,

  -- trial_end após a extensão
  new_end       TIMESTAMPTZ NOT NULL,

  -- Observação opcional do admin
  notes         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Comentários ───────────────────────────────────────────────────────────────

COMMENT ON TABLE public.trial_extensions IS
  'Auditoria imutável de extensões de trial concedidas por admins de plataforma. '
  'Cada empresa pode ter no máximo 1 linha (máximo 1 extensão). '
  'INSERT apenas via RPC extend_company_trial (SECURITY DEFINER). '
  'Sem UPDATE/DELETE por usuários autenticados.';

COMMENT ON COLUMN public.trial_extensions.extended_by IS
  'UUID do usuário que concedeu a extensão. '
  'Deve ser super_admin ou system_admin em empresa pai. '
  'Validado pela RPC — nunca confia no frontend.';

COMMENT ON COLUMN public.trial_extensions.original_end IS
  'trial_end imediatamente antes da extensão ser aplicada. '
  'Permite reconstruir o histórico completo de alterações.';

COMMENT ON COLUMN public.trial_extensions.new_end IS
  'trial_end após a extensão: original_end + 14 dias (fixo). '
  'Ou NOW() + 14 dias se o trial já havia expirado.';

-- ── Índices ───────────────────────────────────────────────────────────────────

-- Lookup principal: extensões por empresa
CREATE INDEX IF NOT EXISTS idx_trial_extensions_company_id
  ON public.trial_extensions (company_id);

-- Lookup por admin (auditoria)
CREATE INDEX IF NOT EXISTS idx_trial_extensions_extended_by
  ON public.trial_extensions (extended_by);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- SELECT: apenas platform admin (super_admin/system_admin em empresa pai)
-- INSERT: apenas service_role via RPC SECURITY DEFINER
-- UPDATE/DELETE: ninguém (auditoria imutável)

ALTER TABLE public.trial_extensions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "te_select_platform_admin"
  ON public.trial_extensions
  FOR SELECT
  TO authenticated
  USING (public.auth_user_is_platform_admin());

COMMENT ON POLICY "te_select_platform_admin" ON public.trial_extensions IS
  'Apenas super_admin e system_admin em empresa pai podem consultar extensões. '
  'INSERT/UPDATE/DELETE: bloqueado para authenticated — apenas service_role (via RPC).';


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. VALIDAÇÃO DO PLANO GROWTH (sem alterar dados)
--
-- Documenta e valida que o plano Growth existe no banco.
-- Esta migration NÃO vincula o plano Growth a nenhuma empresa.
-- NÃO cria company_subscriptions para empresas existentes.
-- O UUID do plano Growth será usado nas RPCs de criação de empresa (Etapa 2).
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_growth_plan_id   UUID;
  v_growth_plan_name TEXT;
BEGIN
  SELECT id, name
    INTO v_growth_plan_id, v_growth_plan_name
    FROM public.plans
   WHERE slug = 'growth'
     AND is_active = true
   LIMIT 1;

  IF v_growth_plan_id IS NULL THEN
    RAISE EXCEPTION
      'TRIAL INFRASTRUCTURE: plano Growth (slug=''growth'') não encontrado ou inativo. '
      'A migration requer que o plano Growth exista antes de prosseguir.';
  END IF;

  RAISE LOG 'TRIAL INFRASTRUCTURE: plano Growth validado. id=%, name=%',
    v_growth_plan_id, v_growth_plan_name;
  RAISE LOG 'TRIAL INFRASTRUCTURE: este UUID deve ser usado como TRIAL_BASE_PLAN_ID nas RPCs de Etapa 2.';
  RAISE LOG 'TRIAL INFRASTRUCTURE: nenhum dado foi alterado. Apenas infraestrutura de schema criada.';
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. VERIFICAÇÃO FINAL — confirmar que nada foi aplicado retroativamente
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_trial_extended_exists BOOLEAN;
  v_trial_extensions_exists BOOLEAN;
BEGIN
  -- Verificar coluna trial_extended
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'company_subscriptions'
       AND column_name  = 'trial_extended'
  ) INTO v_trial_extended_exists;

  -- Verificar tabela trial_extensions
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name   = 'trial_extensions'
  ) INTO v_trial_extensions_exists;

  IF NOT v_trial_extended_exists THEN
    RAISE EXCEPTION 'TRIAL INFRASTRUCTURE: coluna trial_extended não foi criada corretamente.';
  END IF;

  IF NOT v_trial_extensions_exists THEN
    RAISE EXCEPTION 'TRIAL INFRASTRUCTURE: tabela trial_extensions não foi criada corretamente.';
  END IF;

  RAISE LOG '=== add_trial_infrastructure aplicada com sucesso ===';
  RAISE LOG '  company_subscriptions.trial_extended: adicionado (BOOLEAN NOT NULL DEFAULT false)';
  RAISE LOG '  company_subscriptions.trial_start:    já existia (não alterada)';
  RAISE LOG '  company_subscriptions.trial_end:      já existia (não alterada)';
  RAISE LOG '  trial_extensions:                     criada (RLS, índices)';
  RAISE LOG '  plano Growth:                         validado (sem alteração de dados)';
  RAISE LOG '  retroativo:                           NENHUM registro criado ou alterado';
END;
$$;
