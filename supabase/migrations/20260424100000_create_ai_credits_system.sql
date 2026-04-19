-- =====================================================
-- Sistema de Créditos de IA — Etapa 1: Schema
--
-- O que esta migration cria:
--   1. company_credits       — saldo de créditos por empresa
--   2. credit_transactions   — ledger completo de movimentações
--   3. ai_usage_daily        — agregado incremental diário de uso
--   4. credit_packages       — catálogo de pacotes avulsos
--   5. plans.monthly_ai_credits — cota mensal de créditos por plano
--   6. ai_agent_execution_logs.credits_used / feature_type — rastreio de billing
--
-- O que esta migration NÃO faz:
--   - Não altera comportamento de governança (ai_agent_execution_logs existente)
--   - Não cria funções RPC (debit_credits_atomic, renew_company_credits — Etapa 2)
--   - Não cria endpoints nem lógica de negócio
--
-- Separação de sistemas:
--   GOVERNANÇA: ai_agent_execution_logs → tokens, custo OpenAI → empresa pai
--   BILLING:    tabelas desta migration → créditos SaaS → empresa filha + pai
--
-- Regras de negócio dos créditos (documentadas, não enforçadas aqui):
--   plan_credits:  renovados mensalmente; NÃO acumulam; saldo anterior descartado
--   extra_credits: acumulativos; não resetados na renovação; sem expiração (v1)
--   Prioridade de consumo: plan_credits → extra_credits (DO NOT CHANGE)
-- =====================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. TABELA: company_credits
--    Saldo de créditos por empresa. Uma linha por empresa (UNIQUE em company_id).
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.company_credits (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- ─────────────────────────────────────────────────────────────────────────
  -- plan_credits: saldo de créditos mensais do plano contratado.
  --   - Substituído integralmente a cada renovação de ciclo
  --   - NÃO acumula: saldo remanescente do ciclo anterior é descartado
  --   - Consumido ANTES dos extra_credits (prioridade 1)
  -- ─────────────────────────────────────────────────────────────────────────
  plan_credits       INTEGER     NOT NULL DEFAULT 0 CHECK (plan_credits  >= 0),

  -- ─────────────────────────────────────────────────────────────────────────
  -- extra_credits: saldo de créditos avulsos comprados separadamente.
  --   - Acumulativos: compras somam ao saldo existente
  --   - NÃO são resetados na renovação mensal
  --   - Sem expiração nesta versão (v1)
  --   - Consumidos APENAS quando plan_credits = 0 (prioridade 2)
  -- DO NOT CHANGE: consumption priority = plan -> extra
  -- ─────────────────────────────────────────────────────────────────────────
  extra_credits      INTEGER     NOT NULL DEFAULT 0 CHECK (extra_credits >= 0),

  -- Cota mensal configurada no plano vigente (referência do ciclo atual).
  -- Atualizado a cada renovação junto com plan_credits.
  -- Usado para calcular percentual de uso (plan_credits / plan_credits_total).
  plan_credits_total INTEGER     NOT NULL DEFAULT 0,

  -- Timestamp da última renovação de ciclo. NULL = empresa sem renovação registrada.
  last_renewed_at    TIMESTAMPTZ NULL,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT company_credits_unique_company UNIQUE (company_id)
);

COMMENT ON TABLE public.company_credits IS
  'Saldo de créditos de IA por empresa. '
  'plan_credits: renovável mensalmente (não acumulativo). '
  'extra_credits: acumulativo, sem expiração na v1. '
  'Prioridade de consumo: plan_credits → extra_credits.';

COMMENT ON COLUMN public.company_credits.plan_credits IS
  'Saldo de créditos do plano mensal vigente. '
  'Substituído integralmente a cada renovação — saldo anterior descartado. '
  'NÃO acumula entre ciclos. Consumido com prioridade sobre extra_credits.';

COMMENT ON COLUMN public.company_credits.extra_credits IS
  'Saldo de créditos avulsos comprados separadamente. '
  'Acumulativo — compras somam ao saldo. '
  'Não é resetado na renovação mensal. Sem expiração nesta versão (v1). '
  'Consumido apenas após plan_credits esgotar. DO NOT CHANGE: priority = plan -> extra.';

COMMENT ON COLUMN public.company_credits.plan_credits_total IS
  'Cota mensal de créditos do plano vigente no ciclo atual. '
  'Usada para calcular percentual de consumo na UI. '
  'Atualizado junto com plan_credits a cada renovação.';

-- RLS
ALTER TABLE public.company_credits ENABLE ROW LEVEL SECURITY;

-- SELECT: membro ativo da empresa (Trilha 1) OU admin da empresa pai (Trilha 2)
-- DML (INSERT/UPDATE): apenas via RPC SECURITY DEFINER (service_role bypassa RLS)
CREATE POLICY "cc_select_member_or_parent_admin"
  ON public.company_credits
  FOR SELECT
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

-- Trigger de updated_at
CREATE TRIGGER set_updated_at_company_credits
  BEFORE UPDATE ON public.company_credits
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. TABELA: credit_transactions
--    Ledger financeiro completo de todas as movimentações de créditos.
--    Imutável após inserção — nenhuma política de UPDATE/DELETE para usuários.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Tipo de movimentação:
  --   plan_renewal → renovação do ciclo mensal (entrada, plan_credits)
  --   purchase     → compra de pacote avulso (entrada, extra_credits)
  --   usage        → consumo por execução de IA (saída)
  --   adjustment   → ajuste manual por administrador da plataforma
  type                 TEXT        NOT NULL
    CHECK (type IN ('plan_renewal', 'purchase', 'usage', 'adjustment')),

  -- Valor da movimentação. Positivo = entrada. Negativo = saída.
  credits              INTEGER     NOT NULL,

  -- Saldo total (plan + extra) após esta operação.
  balance_after        INTEGER     NOT NULL,

  -- Breakdown do saldo após a operação (para auditoria granular).
  plan_balance_after   INTEGER     NULL,
  extra_balance_after  INTEGER     NULL,

  -- Feature que gerou o uso. NULL para entradas (renovação, compra, ajuste).
  feature_type         TEXT        NULL
    CHECK (feature_type IN ('whatsapp', 'insights')),

  -- Metadados de auditoria. Estrutura varia por tipo:
  --   usage:        { execution_log_id, total_tokens, model }
  --   plan_renewal: { plan_credits_total }
  --   purchase:     { package_id, package_name }
  metadata             JSONB       NOT NULL DEFAULT '{}'::jsonb,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
  -- Sem updated_at: ledger financeiro é imutável após inserção
);

COMMENT ON TABLE public.credit_transactions IS
  'Ledger de movimentações de créditos de IA por empresa. '
  'Imutável após inserção. Credits positivo = entrada, negativo = saída. '
  'Tipos: plan_renewal, purchase, usage, adjustment.';

COMMENT ON COLUMN public.credit_transactions.metadata IS
  'Metadados de auditoria. Para type=usage: { execution_log_id, total_tokens, model }. '
  'Para type=plan_renewal: { plan_credits_total }. '
  'Para type=purchase: { package_id, package_name }.';

-- Índice obrigatório — queries de histórico paginado por empresa
CREATE INDEX IF NOT EXISTS idx_credit_transactions_company_created
  ON public.credit_transactions (company_id, created_at DESC);

-- RLS
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- SELECT: membro ativo da empresa OU admin da empresa pai
-- DML: apenas via RPC SECURITY DEFINER
CREATE POLICY "ct_select_member_or_parent_admin"
  ON public.credit_transactions
  FOR SELECT
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. TABELA: ai_usage_daily
--    Agregado incremental diário de uso de IA por empresa e feature.
--    Atualizada em tempo real via UPSERT dentro de debit_credits_atomic (Etapa 2).
--    Fonte dos dashboards de billing — O(1) por período consultado.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

  -- Data do agregado (dia local da execução)
  date               DATE        NOT NULL,

  -- Feature que gerou o uso
  feature_type       TEXT        NOT NULL
    CHECK (feature_type IN ('whatsapp', 'insights')),

  -- Totais acumulados do dia
  total_tokens       BIGINT      NOT NULL DEFAULT 0,
  total_credits_used INTEGER     NOT NULL DEFAULT 0,
  executions_count   INTEGER     NOT NULL DEFAULT 0,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Chave única para UPSERT incremental em debit_credits_atomic
  CONSTRAINT ai_usage_daily_unique UNIQUE (company_id, date, feature_type)
);

COMMENT ON TABLE public.ai_usage_daily IS
  'Agregado incremental diário de uso de IA por empresa e feature. '
  'Atualizado via UPSERT dentro de debit_credits_atomic (mesma transação). '
  'Fonte de dados exclusiva para mode=billing no endpoint de summary. '
  'Não consultar ai_agent_execution_logs para queries de billing.';

COMMENT ON COLUMN public.ai_usage_daily.total_tokens IS
  'Total de tokens consumidos no dia. Acumulado incrementalmente por UPSERT.';

COMMENT ON COLUMN public.ai_usage_daily.total_credits_used IS
  'Total de créditos debitados no dia. Acumulado incrementalmente por UPSERT.';

-- Índice obrigatório — queries de período no endpoint mode=billing
CREATE INDEX IF NOT EXISTS idx_ai_usage_daily_company_date
  ON public.ai_usage_daily (company_id, date DESC);

-- RLS
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;

-- SELECT: membro ativo da empresa OU admin da empresa pai
-- DML: apenas via RPC SECURITY DEFINER
CREATE POLICY "aud_select_member_or_parent_admin"
  ON public.ai_usage_daily
  FOR SELECT
  TO authenticated
  USING (
    auth_user_is_company_member(company_id)
    OR auth_user_is_parent_admin(company_id)
  );

-- Trigger de updated_at
CREATE TRIGGER set_updated_at_ai_usage_daily
  BEFORE UPDATE ON public.ai_usage_daily
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. TABELA: credit_packages
--    Catálogo de pacotes avulsos de créditos gerenciado pela empresa pai.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.credit_packages (
  id         UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT           NOT NULL,
  credits    INTEGER        NOT NULL CHECK (credits > 0),
  price      NUMERIC(10, 2) NOT NULL CHECK (price >= 0),

  -- ─────────────────────────────────────────────────────────────────────────
  -- valid_days: RESERVADO PARA COMPATIBILIDADE FUTURA.
  --   Sem efeito funcional nesta versão (v1).
  --   Não implementar lógica de expiração com base neste campo até v2.
  --   Evolução planejada: tabela credit_lots com expiração por lote (v2).
  -- ─────────────────────────────────────────────────────────────────────────
  valid_days INTEGER        NULL,

  is_active  BOOLEAN        NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.credit_packages IS
  'Catálogo de pacotes avulsos de créditos de IA. '
  'Gerenciado exclusivamente pela empresa pai (platform admin). '
  'Compra de pacote expande extra_credits da empresa contratante.';

COMMENT ON COLUMN public.credit_packages.valid_days IS
  'RESERVADO PARA USO FUTURO (v2). '
  'Sem efeito funcional nesta versão. '
  'Não implementar lógica de expiração com base neste campo. '
  'Evolução planejada: credit_lots com expiração por lote individual.';

-- RLS
ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer usuário autenticado pode listar pacotes disponíveis
CREATE POLICY "cp_select_authenticated"
  ON public.credit_packages
  FOR SELECT
  TO authenticated
  USING (true);

-- INSERT / UPDATE / DELETE: exclusivo de administradores da plataforma
CREATE POLICY "cp_all_platform_admin"
  ON public.credit_packages
  FOR ALL
  TO authenticated
  USING (auth_user_is_platform_admin())
  WITH CHECK (auth_user_is_platform_admin());

-- Trigger de updated_at
CREATE TRIGGER set_updated_at_credit_packages
  BEFORE UPDATE ON public.credit_packages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. ALTER: plans — adicionar cota mensal de créditos de IA
--    Alteração não destrutiva. DEFAULT 0 = sem créditos de IA por padrão.
--    Planos existentes não são afetados.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS monthly_ai_credits INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.plans.monthly_ai_credits IS
  'Cota mensal de créditos de IA incluídos neste plano. '
  '0 = sem créditos de IA. '
  'ATENÇÃO: alteração deste campo afeta APENAS a próxima renovação das empresas '
  'que usam este plano. O ciclo em andamento não é impactado.';


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. ALTER: ai_agent_execution_logs — adicionar campos de billing
--    Alterações não destrutivas (nullable, sem impacto em registros existentes).
--    Preenchidos pela Etapa 2 (debit_credits_atomic) após cada execução.
--    O uso atual de governança (tokens, custo OpenAI) permanece intacto.
-- ══════════════════════════════════════════════════════════════════════════════

-- Quantidade de créditos debitados nesta execução.
-- NULL = execução anterior à implementação do billing, sandbox ou feature sem billing.
ALTER TABLE public.ai_agent_execution_logs
  ADD COLUMN IF NOT EXISTS credits_used INTEGER NULL;

-- Feature que gerou o débito. Alinhado com ai_usage_daily.feature_type.
-- NULL = execução sem billing associado (sandbox, test, etc.).
ALTER TABLE public.ai_agent_execution_logs
  ADD COLUMN IF NOT EXISTS feature_type TEXT NULL
    CHECK (feature_type IN ('whatsapp', 'insights'));

COMMENT ON COLUMN public.ai_agent_execution_logs.credits_used IS
  'Créditos debitados para esta execução via debit_credits_atomic. '
  'NULL para execuções anteriores ao sistema de billing, sandbox ou execuções sem feature_type. '
  'Preenchido pela Etapa 2 (debit_credits_atomic) — não alterar manualmente.';

COMMENT ON COLUMN public.ai_agent_execution_logs.feature_type IS
  'Feature de IA que gerou o débito de créditos. '
  'whatsapp: multiplicador 1x. insights: multiplicador 6x. '
  'NULL para sandbox, test ou execuções sem billing. '
  'Deve estar alinhado com ai_usage_daily.feature_type para consistência.';

-- NOTA: O índice (consumer_company_id, created_at DESC) já existe como
-- idx_ai_agent_logs_company_time (criado em 20260407220000_ai_agent_execution_logs.sql).
-- Nenhum índice duplicado será criado aqui.


-- ══════════════════════════════════════════════════════════════════════════════
-- 7. INICIALIZAÇÃO: company_credits para empresas existentes
--    Garante que toda empresa já cadastrada tenha um registro com saldo zero.
--    Idempotente via ON CONFLICT DO NOTHING.
--    Empresas criadas futuramente devem ter o registro criado pela Etapa 2
--    (renew_company_credits) ou via RPC de onboarding.
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.company_credits (company_id)
SELECT id FROM public.companies
ON CONFLICT (company_id) DO NOTHING;
