-- =====================================================
-- Migration: alter_dashboard_ai_analyses
--
-- Ajustes pós-criação da tabela dashboard_ai_analyses:
--
-- 1. CHECK analysis_type  → apenas tipos MVP (ai_attendance e custom_question
--                           ficarão para nova migration quando implementados)
-- 2. input_hash           → NOT NULL (cache, mutex e retomada dependem dele)
-- 3. Constraint completed → garante integridade quando status = 'completed'
-- 4. user_id FK           → REFERENCES auth.users(id) — padrão já usado no projeto
-- 5. Índice mutex         → cobre os 6 campos chave para detecção de processamento duplicado
-- 6. started_at           → coluna TIMESTAMPTZ para medir início real do processamento
-- =====================================================


-- ──────────────────────────────────────────────────────────────────────────────
-- 1. CHECK analysis_type — somente tipos MVP
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dashboard_ai_analyses
  DROP CONSTRAINT IF EXISTS chk_dai_analysis_type;

ALTER TABLE public.dashboard_ai_analyses
  ADD CONSTRAINT chk_dai_analysis_type CHECK (analysis_type IN (
    'cooling_opportunities',
    'conversion_drop',
    'funnel_overview'
    -- ai_attendance e custom_question: reservados para fases futuras via nova migration
  ));

COMMENT ON COLUMN public.dashboard_ai_analyses.analysis_type IS
  'Tipo de análise. MVP: cooling_opportunities, conversion_drop, funnel_overview. '
  'Novos tipos exigem nova migration para expandir o CHECK constraint.';


-- ──────────────────────────────────────────────────────────────────────────────
-- 2. input_hash NOT NULL
-- ──────────────────────────────────────────────────────────────────────────────

-- Preencher valores existentes que possam estar NULL antes de adicionar NOT NULL
UPDATE public.dashboard_ai_analyses
  SET input_hash = 'backfill-' || id::text
WHERE input_hash IS NULL;

ALTER TABLE public.dashboard_ai_analyses
  ALTER COLUMN input_hash SET NOT NULL;

COMMENT ON COLUMN public.dashboard_ai_analyses.input_hash IS
  'Hash SHA-256 determinístico do contexto: company_id + analysis_type + funnel_id + '
  'period + context_version + assinatura dos dados agregados. '
  'NOT NULL: cache, mutex e retomada dependem deste campo. '
  'Usado para cache: análise completed com mesmo hash < 24h → retornar cache_available.';


-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Constraint de integridade para status = 'completed'
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dashboard_ai_analyses
  ADD CONSTRAINT chk_dai_completed_integrity CHECK (
    status != 'completed'
    OR (
      output        IS NOT NULL
      AND output    <> '{}'::jsonb
      AND credits_used  IS NOT NULL
      AND completed_at  IS NOT NULL
    )
  );

COMMENT ON CONSTRAINT chk_dai_completed_integrity ON public.dashboard_ai_analyses IS
  'Garante que status=completed só pode ser setado quando output, credits_used e '
  'completed_at estiverem preenchidos. Evita registros completed inválidos.';


-- ──────────────────────────────────────────────────────────────────────────────
-- 4. user_id FK para auth.users(id)
--    Compatível com o padrão já adotado no projeto em várias outras tabelas.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dashboard_ai_analyses
  ADD CONSTRAINT fk_dai_user_id
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dashboard_ai_analyses.user_id IS
  'auth.uid() no momento da solicitação. '
  'FK para auth.users(id) ON DELETE SET NULL: preserva histórico mesmo se usuário for removido.';


-- ──────────────────────────────────────────────────────────────────────────────
-- 5. Índice específico para mutex
--    Cobre os 6 campos chave usados na verificação de processamento duplicado.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_dai_mutex
  ON public.dashboard_ai_analyses (
    company_id,
    analysis_type,
    funnel_id,
    period,
    input_hash,
    status
  );

COMMENT ON INDEX public.idx_dai_mutex IS
  'Mutex: detectar análise pending/processing com mesmo contexto. '
  'Evita execuções duplicadas em até 5 minutos.';


-- ──────────────────────────────────────────────────────────────────────────────
-- 6. Coluna started_at
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dashboard_ai_analyses
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

COMMENT ON COLUMN public.dashboard_ai_analyses.started_at IS
  'Timestamp de início real do processamento (status → processing). '
  'NULL quando status = pending, awaiting_credits ou failed antes de iniciar. '
  'Usado para medir duração real da execução LLM.';
