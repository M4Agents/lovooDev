-- =============================================================
-- Migration: get_stage_opportunity_ids_filtered
--
-- Resolve os UUIDs de oportunidades elegíveis para uma etapa
-- com filtros opcionais (search, origin, period_days).
--
-- Critérios idênticos a get_stage_positions_paged e
-- get_funnel_stage_counts para garantir consistência entre
-- contagem, listagem e movimentação em massa.
--
-- Usada por: api/funnel/bulk-move-opportunities/index.js
-- quando há filtros ativos (para resolver IDs antes de chamar
-- bulk_move_opportunities).
-- =============================================================

CREATE OR REPLACE FUNCTION get_stage_opportunity_ids_filtered(
  p_funnel_id   UUID,
  p_stage_id    UUID,
  p_company_id  UUID,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INTEGER DEFAULT NULL
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(ofp.opportunity_id)
  INTO v_ids
  FROM opportunity_funnel_positions ofp
  JOIN opportunities o ON o.id = ofp.opportunity_id
  JOIN leads l         ON l.id = o.lead_id
  WHERE ofp.funnel_id = p_funnel_id
    AND ofp.stage_id  = p_stage_id
    AND o.company_id  = p_company_id
    AND l.deleted_at  IS NULL
    AND (
      p_search IS NULL
      OR l.name  ILIKE '%' || p_search || '%'
      OR l.phone ILIKE '%' || p_search || '%'
      OR l.email ILIKE '%' || p_search || '%'
    )
    AND (p_origin      IS NULL OR l.origin = p_origin)
    AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL);

  RETURN COALESCE(v_ids, ARRAY[]::UUID[]);
END;
$$;
