-- Paginação da coluna de leads sem tarefa.
-- p_offset ausente continua valendo 0, então a chamada anterior segue na primeira página.

DROP FUNCTION IF EXISTS public.list_taskless_lead_positions(uuid, uuid, uuid, timestamptz, timestamptz, integer);

CREATE OR REPLACE FUNCTION public.list_taskless_lead_positions(
  p_company_id uuid,
  p_user_id uuid,
  p_responsible_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 100000);
  v_total integer;
  v_items jsonb;
  v_configured boolean;
BEGIN
  IF p_company_id IS NULL OR p_user_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from >= p_to THEN
    RAISE EXCEPTION 'invalid_taskless_window' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_taskless_stages
    WHERE company_id = p_company_id
      AND user_id = p_user_id
  ) INTO v_configured;

  WITH filtered AS (
    SELECT
      ofp.id,
      ofp.lead_id,
      l.name AS lead_name,
      ofp.funnel_id,
      f.name AS funnel_name,
      ofp.stage_id,
      fs.name AS stage_name,
      ofp.entered_stage_at,
      l.responsible_user_id
    FROM public.opportunity_funnel_positions ofp
    JOIN public.user_taskless_stages uts
      ON uts.company_id = p_company_id
     AND uts.user_id = p_user_id
     AND uts.stage_id = ofp.stage_id
    JOIN public.sales_funnels f
      ON f.id = ofp.funnel_id
     AND f.company_id = p_company_id
    JOIN public.funnel_stages fs
      ON fs.id = ofp.stage_id
     AND fs.funnel_id = f.id
    JOIN public.leads l
      ON l.id = ofp.lead_id
     AND l.company_id = p_company_id
     AND l.deleted_at IS NULL
    LEFT JOIN public.opportunities o
      ON o.id = ofp.opportunity_id
    WHERE (ofp.opportunity_id IS NULL OR o.company_id = p_company_id)
      AND ofp.entered_stage_at >= p_from
      AND ofp.entered_stage_at < p_to
      AND (p_responsible_user_id IS NULL OR l.responsible_user_id = p_responsible_user_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_activities a
        WHERE a.company_id = p_company_id
          AND a.lead_id = ofp.lead_id
          AND a.status = 'pending'
      )
  )
  SELECT count(*)::integer INTO v_total FROM filtered;

  WITH filtered AS (
    SELECT
      ofp.id,
      ofp.lead_id,
      l.name AS lead_name,
      ofp.funnel_id,
      f.name AS funnel_name,
      ofp.stage_id,
      fs.name AS stage_name,
      ofp.entered_stage_at,
      l.responsible_user_id
    FROM public.opportunity_funnel_positions ofp
    JOIN public.user_taskless_stages uts
      ON uts.company_id = p_company_id
     AND uts.user_id = p_user_id
     AND uts.stage_id = ofp.stage_id
    JOIN public.sales_funnels f
      ON f.id = ofp.funnel_id
     AND f.company_id = p_company_id
    JOIN public.funnel_stages fs
      ON fs.id = ofp.stage_id
     AND fs.funnel_id = f.id
    JOIN public.leads l
      ON l.id = ofp.lead_id
     AND l.company_id = p_company_id
     AND l.deleted_at IS NULL
    LEFT JOIN public.opportunities o
      ON o.id = ofp.opportunity_id
    WHERE (ofp.opportunity_id IS NULL OR o.company_id = p_company_id)
      AND ofp.entered_stage_at >= p_from
      AND ofp.entered_stage_at < p_to
      AND (p_responsible_user_id IS NULL OR l.responsible_user_id = p_responsible_user_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.lead_activities a
        WHERE a.company_id = p_company_id
          AND a.lead_id = ofp.lead_id
          AND a.status = 'pending'
      )
  ),
  page AS (
    SELECT *
    FROM filtered
    ORDER BY entered_stage_at ASC NULLS LAST, id ASC
    LIMIT v_limit
    OFFSET v_offset
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'position_id', page.id,
      'lead_id', page.lead_id,
      'lead_name', page.lead_name,
      'funnel_id', page.funnel_id,
      'funnel_name', page.funnel_name,
      'stage_id', page.stage_id,
      'stage_name', page.stage_name,
      'entered_stage_at', page.entered_stage_at,
      'responsible_user_id', page.responsible_user_id,
      'last_completed_at', (
        SELECT max(a.completed_at)
        FROM public.lead_activities a
        WHERE a.company_id = p_company_id
          AND a.lead_id = page.lead_id
          AND a.status = 'completed'
      )
    )
    ORDER BY page.entered_stage_at ASC NULLS LAST, page.id ASC
  ), '[]'::jsonb)
  INTO v_items
  FROM page;

  RETURN jsonb_build_object(
    'configured', v_configured,
    'total', v_total,
    'items', v_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_taskless_lead_positions(uuid, uuid, uuid, timestamptz, timestamptz, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_taskless_lead_positions(uuid, uuid, uuid, timestamptz, timestamptz, integer, integer)
  TO service_role;
