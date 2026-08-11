-- =====================================================
-- MIGRATION: RPC get_agent_execution_summary
-- Data: 2026-08-11
--
-- Propósito:
--   Agregar métricas de ai_agent_execution_logs inteiramente no banco,
--   eliminando o cap silencioso de max_rows=1000 do PostgREST que causava
--   subestimação de execuções, tokens e custo estimado no dashboard de custos
--   em api/agents/logs/summary.ts.
--
-- Regra de negócio confirmada (migration 20260407220000):
--   "SELECT: restrito a admin/super_admin da empresa pai.
--    Tenants NÃO acessam logs — nem os próprios nem os de outros."
--   super_admin/admin da empresa pai possuem acesso global a todos os logs.
--   consumer_company_id funciona exclusivamente como filtro de visualização,
--   não como controle de acesso. Sem validação de hierarquia parent/client —
--   comportamento idêntico ao endpoint summary.ts anterior.
--
-- Autenticação:
--   Não existe dentro desta função. Garantida pelo endpoint
--   api/agents/logs/summary.ts via assertCanManageOpenAIIntegration
--   (JWT válido + company_users: role IN [super_admin, admin], empresa pai).
--
-- Chamada exclusiva via service_role (backend Vercel).
--   REVOKE/GRANT impede chamada direta por anon ou authenticated (frontend).
--
-- Semântica idêntica ao comportamento anterior de summary.ts:
--   filtros:       >= p_from (inclusivo), <= p_to (inclusivo)
--   status/use_id/consumer_company_id: igualdade exata
--   parâmetro NULL = sem filtro (equivalente à ausência do .eq() no JS)
--   erros:         status IN ('error_missing_context','error_openai','error_db')
--   fallback:      is_fallback = TRUE
--   NULL em tokens/cost tratados como 0 (COALESCE)
--   by_status:     {} quando sem registros (COALESCE de jsonb_object_agg)
--   taxas:         0 quando total_executions = 0 (sem divisão por zero)
--
-- Nota: ai_agent_execution_logs.status é NOT NULL (constraint confirmado).
--   jsonb_object_agg nunca recebe chave NULL nesta função.
--
-- Débito técnico registrado (fora do escopo desta migration):
--   assertCanManageOpenAIIntegration não filtra is_active em company_users.
--   Um admin desativado com sessão JWT ainda válida pode acessar o endpoint.
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_agent_execution_summary(
  p_from                TIMESTAMPTZ DEFAULT NULL,
  p_to                  TIMESTAMPTZ DEFAULT NULL,
  p_status              TEXT        DEFAULT NULL,
  p_use_id              TEXT        DEFAULT NULL,
  p_consumer_company_id UUID        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_total_executions BIGINT  := 0;
  v_total_tokens     BIGINT  := 0;
  v_total_cost       NUMERIC := 0;
  v_error_count      BIGINT  := 0;
  v_fallback_count   BIGINT  := 0;
  v_by_status        JSONB   := '{}'::JSONB;
BEGIN

  -- ── Agregação principal (passagem única via CTE) ──────────────────────────
  --
  -- CTE "filtered": aplica os mesmos filtros do summary.ts anterior.
  -- Condicionais com IS NULL preservam o comportamento de filtro opcional:
  --   parâmetro NULL = sem filtro = equivalente à ausência do .eq() no JS.
  --
  -- Operadores alinhados com o Supabase JS client anterior:
  --   created_at >= p_from  →  .gte('created_at', from)
  --   created_at <= p_to    →  .lte('created_at', to)
  --   status = p_status     →  .eq('status', status)
  --   use_id = p_use_id     →  .eq('use_id', useId)
  --   consumer_company_id = p_consumer_company_id → .eq(...)

  WITH filtered AS (
    SELECT
      status,
      is_fallback,
      total_tokens,
      estimated_cost_usd
    FROM public.ai_agent_execution_logs
    WHERE
          (p_from                IS NULL OR created_at              >= p_from)
      AND (p_to                  IS NULL OR created_at              <= p_to)
      AND (p_status              IS NULL OR status                  =  p_status)
      AND (p_use_id              IS NULL OR use_id                  =  p_use_id)
      AND (p_consumer_company_id IS NULL OR consumer_company_id     =  p_consumer_company_id)
  )
  SELECT
    COUNT(*)::BIGINT,
    COALESCE(SUM(total_tokens),       0)::BIGINT,
    COALESCE(SUM(estimated_cost_usd), 0),
    -- Erros: alinhado com ERROR_STATUSES de summary.ts anterior
    COUNT(*) FILTER (WHERE status IN (
      'error_missing_context', 'error_openai', 'error_db'
    ))::BIGINT,
    -- Fallback: alinhado com row.is_fallback (boolean true)
    COUNT(*) FILTER (WHERE is_fallback = TRUE)::BIGINT,
    -- by_status: {} quando sem registros (COALESCE garante objeto vazio, não null)
    -- status é NOT NULL na tabela, portanto jsonb_object_agg nunca recebe chave null
    COALESCE(
      ( SELECT jsonb_object_agg(s.status, s.cnt)
        FROM   ( SELECT status, COUNT(*)::BIGINT AS cnt
                 FROM   filtered
                 GROUP  BY status ) s ),
      '{}'::JSONB
    )
  INTO
    v_total_executions,
    v_total_tokens,
    v_total_cost,
    v_error_count,
    v_fallback_count,
    v_by_status
  FROM filtered;

  -- ── Retorno (estrutura idêntica ao contrato do endpoint) ──────────────────
  --
  -- estimated_cost_usd: ROUND(..., 8) → alinhado com Math.round(x * 1e8) / 1e8
  -- error_rate/fallback_rate: ROUND(..., 6) → alinhado com Math.round(x * 1e6) / 1e6
  RETURN jsonb_build_object(
    'total_executions',   v_total_executions,
    'total_tokens',       v_total_tokens,
    'estimated_cost_usd', ROUND(v_total_cost, 8),
    'error_rate',
      CASE WHEN v_total_executions = 0 THEN 0::NUMERIC
           ELSE ROUND(v_error_count::NUMERIC    / v_total_executions, 6)
      END,
    'fallback_rate',
      CASE WHEN v_total_executions = 0 THEN 0::NUMERIC
           ELSE ROUND(v_fallback_count::NUMERIC / v_total_executions, 6)
      END,
    'by_status', v_by_status
  );

END;
$$;

COMMENT ON FUNCTION public.get_agent_execution_summary(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, UUID
) IS
'Agrega métricas de ai_agent_execution_logs inteiramente no banco,
eliminando o cap de max_rows=1000 do PostgREST no dashboard de custos.
Acesso exclusivo via service_role (backend). Auth tratada pelo endpoint.
Regra de negócio: super_admin/admin da empresa pai têm visão global de todos
os logs; consumer_company_id é filtro de visualização, não controle de acesso.';

-- ── Permissões ────────────────────────────────────────────────────────────────
-- Chamada exclusivamente pelo backend via service_role.
-- anon e authenticated não devem ter acesso direto.
-- REVOKE ALL FROM PUBLIC remove o grant público, mas Supabase aplica default
-- privileges individuais para anon e authenticated — ambos precisam de REVOKE explícito.
REVOKE ALL     ON FUNCTION public.get_agent_execution_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_agent_execution_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_agent_execution_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_agent_execution_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, UUID) TO service_role;
