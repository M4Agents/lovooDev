-- =====================================================
-- MIGRATION: get_funnel_stage_counts
-- Data: 03/04/2026
-- Objetivo: RPC de contadores por etapa. Retorna count e
--           total_value para todas as etapas de um funil
--           em uma única query, respeitando os mesmos filtros
--           aplicados na listagem de cards.
--
-- Usado pelo hook useStageCounts para exibir totais reais
-- no cabeçalho de cada coluna, independente da paginação.
--
-- Retorno: JSONB array de { stage_id, count, total_value }
-- =====================================================

CREATE OR REPLACE FUNCTION get_funnel_stage_counts(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_search      TEXT DEFAULT NULL,
  p_origin      TEXT DEFAULT NULL,
  p_period_days INT  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'stage_id',    ofp.stage_id,
        'count',       COUNT(*)::int,
        'total_value', COALESCE(SUM(o.value), 0)::numeric
      )
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM opportunity_funnel_positions ofp
  JOIN  opportunities o ON o.id = ofp.opportunity_id
  JOIN  leads         l ON l.id = o.lead_id
  WHERE ofp.funnel_id  = p_funnel_id
    AND o.company_id   = p_company_id  -- ISOLAMENTO MULTI-TENANT
    AND l.deleted_at   IS NULL
    AND (
      p_search IS NULL
      OR l.name  ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.email ILIKE '%' || p_search || '%'
    )
    AND (p_origin IS NULL OR l.origin = p_origin)
    AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
  GROUP BY ofp.stage_id;

  RETURN v_result;
END;
$$;
