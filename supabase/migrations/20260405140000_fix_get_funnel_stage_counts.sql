-- =====================================================
-- MIGRATION: fix get_funnel_stage_counts
-- Data: 05/04/2026
-- Objetivo: Corrigir erro de cardinalidade na RPC.
--
-- PROBLEMA ORIGINAL:
--   O SELECT ... INTO v_result combinado com GROUP BY stage_id
--   produzia N linhas (uma por etapa). O PL/pgSQL falha com
--   "ERROR 21000: query returned more than one row" ao tentar
--   atribuir N linhas a uma única variável JSONB.
--   Resultado: HTTP 400 em toda chamada → counts sempre undefined
--   → "Carregar 0 restantes" mesmo com hasMore = true.
--
-- CORREÇÃO:
--   Mover o GROUP BY para uma subquery. O outer SELECT aplica
--   jsonb_agg sobre os objetos já construídos, produzindo
--   exatamente 1 linha JSONB para atribuição via INTO.
--
-- ASSINATURA INALTERADA (sem overload):
--   get_funnel_stage_counts(uuid, uuid, text, text, int)
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
  -- Subquery agrupa por stage_id e constrói um objeto por etapa.
  -- Outer SELECT agrega todos os objetos em um único array JSONB.
  -- SELECT INTO recebe exatamente 1 linha → sem erro de cardinalidade.
  SELECT COALESCE(jsonb_agg(stage_data), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'stage_id',    ofp.stage_id,
      'count',       COUNT(*)::int,
      'total_value', COALESCE(SUM(o.value), 0)::numeric
    ) AS stage_data
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
    GROUP BY ofp.stage_id
  ) subq;

  RETURN v_result;
END;
$$;
