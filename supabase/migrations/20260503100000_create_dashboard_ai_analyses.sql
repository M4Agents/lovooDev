-- =====================================================
-- Migration: create_dashboard_ai_analyses
--
-- Tabela de análises de IA sob demanda geradas pelo Dashboard.
-- Cada registro representa uma solicitação de análise LLM por empresa/usuário.
--
-- Ciclo de vida do status:
--   pending          → criado, aguardando execução
--   processing       → contexto montado, LLM em andamento
--   awaiting_credits → saldo insuficiente; input_summary salvo para retomada
--   completed        → análise gerada e créditos debitados
--   failed           → erro na execução (LLM ou schema inválido)
--   credit_failed    → LLM executou mas débito falhou; output bloqueado
--
-- Regras críticas:
--   - company_id e user_id derivados do membership no backend (nunca do frontend)
--   - input_summary NUNCA deve conter dados sensíveis (nome, CPF, telefone, email)
--   - output NÃO deve ser retornado pela API quando status = 'credit_failed'
--   - awaiting_credits deve conter input_summary completo para retomada sem re-query
--
-- RLS:
--   SELECT  — membro ativo da empresa
--   INSERT  — bloqueado (apenas via service_role / backend API)
--   UPDATE  — bloqueado (apenas via service_role / backend API)
--   DELETE  — bloqueado (apenas via service_role / backend API)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.dashboard_ai_analyses (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── Contexto multi-tenant ────────────────────────────────────────────────
  company_id        UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id           UUID        NOT NULL,  -- auth.uid() no momento da solicitação

  -- ── Tipo e escopo da análise ─────────────────────────────────────────────
  analysis_type     TEXT        NOT NULL,
  funnel_id         UUID,                  -- NULL = todos os funis da empresa
  period            TEXT,                  -- ex: '30d', '7d', 'custom'

  -- ── Cache e versionamento de contexto ────────────────────────────────────
  context_version   TEXT        NOT NULL DEFAULT 'v1',
  input_hash        TEXT,                  -- hash(company_id+type+funnel+period+context_version+dados_agregados)

  -- ── Dados de entrada e saída ─────────────────────────────────────────────
  -- input_summary: contexto agregado seguro enviado à LLM (sem dados sensíveis)
  -- Obrigatoriamente preenchido em status awaiting_credits para permitir retomada.
  input_summary     JSONB       NOT NULL DEFAULT '{}',

  -- output: retorno estruturado da LLM
  -- { title, summary, findings[], recommended_actions[], next_best_actions[], limitations[] }
  -- NÃO expor via API quando status = 'credit_failed'
  output            JSONB       NOT NULL DEFAULT '{}',

  -- ── Créditos ─────────────────────────────────────────────────────────────
  estimated_credits INTEGER,               -- calculado antes da chamada LLM
  credits_used      INTEGER,               -- tokens reais debitados pós-LLM

  -- ── Execução ─────────────────────────────────────────────────────────────
  model             TEXT,                  -- ex: 'gpt-4o-mini'
  status            TEXT        NOT NULL DEFAULT 'pending',
  error_message     TEXT,
  completed_at      TIMESTAMPTZ,

  -- ── Rastreabilidade ──────────────────────────────────────────────────────
  -- metadata inclui: { source, analysis_id, analysis_type, total_tokens, model }
  -- espelhado no ledger credit_transactions para auditoria no extrato de IA
  metadata          JSONB       NOT NULL DEFAULT '{}',

  -- ── Timestamps ───────────────────────────────────────────────────────────
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── Restrições de domínio ────────────────────────────────────────────────
  CONSTRAINT chk_dai_status CHECK (status IN (
    'pending',
    'processing',
    'awaiting_credits',
    'completed',
    'failed',
    'credit_failed'
  )),

  -- MVP: cooling_opportunities, conversion_drop, funnel_overview
  -- Reservados para fases futuras: ai_attendance, custom_question
  CONSTRAINT chk_dai_analysis_type CHECK (analysis_type IN (
    'cooling_opportunities',
    'conversion_drop',
    'funnel_overview',
    'ai_attendance',
    'custom_question'
  ))
);

COMMENT ON TABLE public.dashboard_ai_analyses IS
  'Análises de IA analítica sob demanda geradas pelo Dashboard. '
  'Cada registro representa uma solicitação LLM por empresa/usuário. '
  'MVP: cooling_opportunities, conversion_drop, funnel_overview. '
  'Debitado via debit_credits_atomic com feature_type=insights (6x). '
  'output bloqueado via API quando status=credit_failed.';

COMMENT ON COLUMN public.dashboard_ai_analyses.input_summary IS
  'Contexto agregado seguro enviado à LLM. Nunca conter dados sensíveis '
  '(nome, CPF, telefone, email, conteúdo bruto de conversa). '
  'Apenas contagens, médias, IDs opacos e resumos. '
  'Deve ser preenchido integralmente em status=awaiting_credits para retomada sem re-query.';

COMMENT ON COLUMN public.dashboard_ai_analyses.output IS
  'Retorno estruturado da LLM: { title, summary, findings[], recommended_actions[], '
  'next_best_actions[], limitations[] }. '
  'NÃO deve ser exposto pela API quando status=credit_failed.';

COMMENT ON COLUMN public.dashboard_ai_analyses.input_hash IS
  'Hash determinístico do contexto: company_id + analysis_type + funnel_id + '
  'period + context_version + assinatura dos dados agregados. '
  'Usado para cache: análise completed com mesmo hash < 24h → retornar cache_available.';

COMMENT ON COLUMN public.dashboard_ai_analyses.metadata IS
  'Metadados de rastreabilidade. Espelhado no ledger credit_transactions. '
  'Campos esperados: source (dashboard_ai_analysis), analysis_type, total_tokens, model.';


-- ══════════════════════════════════════════════════════════════════════════════
-- ÍNDICES
-- ══════════════════════════════════════════════════════════════════════════════

-- Acesso primário por empresa ordenado por data (histórico, paginação)
CREATE INDEX IF NOT EXISTS idx_dai_company_created
  ON public.dashboard_ai_analyses (company_id, created_at DESC);

-- Mutex e cache: verificar análises recentes por tipo + contexto
CREATE INDEX IF NOT EXISTS idx_dai_company_type_ctx
  ON public.dashboard_ai_analyses (company_id, analysis_type, funnel_id, period, created_at DESC);

-- Cache por hash: verificar completed com mesmo input_hash
CREATE INDEX IF NOT EXISTS idx_dai_company_hash
  ON public.dashboard_ai_analyses (company_id, input_hash, status);

-- Busca por status: processing, awaiting_credits (mutex e retomada)
CREATE INDEX IF NOT EXISTS idx_dai_company_status
  ON public.dashboard_ai_analyses (company_id, status);


-- ══════════════════════════════════════════════════════════════════════════════
-- RLS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.dashboard_ai_analyses ENABLE ROW LEVEL SECURITY;

-- SELECT: qualquer membro ativo da empresa pode ler o histórico de análises
-- Filtragem de output para credit_failed é responsabilidade do backend (API layer)
CREATE POLICY "dai_select"
  ON public.dashboard_ai_analyses
  FOR SELECT
  USING (auth_user_is_company_member(company_id));

-- INSERT: bloqueado no cliente — apenas via service_role (backend API)
-- O backend valida auth, membership e feature flag antes de inserir
CREATE POLICY "dai_insert"
  ON public.dashboard_ai_analyses
  FOR INSERT
  WITH CHECK (false);

-- UPDATE: bloqueado no cliente — apenas via service_role (backend API)
CREATE POLICY "dai_update"
  ON public.dashboard_ai_analyses
  FOR UPDATE
  USING (false);

-- DELETE: bloqueado no cliente — preservar histórico e rastreabilidade
CREATE POLICY "dai_delete"
  ON public.dashboard_ai_analyses
  FOR DELETE
  USING (false);
