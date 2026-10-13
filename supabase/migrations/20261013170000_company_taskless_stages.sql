-- Etapas que a empresa escolhe para a coluna "Leads sem tarefas".
-- A leitura e a troca do conjunto passam pelas rotas /api/activities/taskless-*,
-- com service_role depois da validação de membership. O JWT não acessa a tabela.

CREATE TABLE public.company_taskless_stages (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.funnel_stages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, stage_id)
);

CREATE INDEX company_taskless_stages_stage_id_idx
  ON public.company_taskless_stages (stage_id);

ALTER TABLE public.company_taskless_stages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.company_taskless_stages FROM PUBLIC;
REVOKE ALL ON TABLE public.company_taskless_stages FROM anon;
REVOKE ALL ON TABLE public.company_taskless_stages FROM authenticated;
GRANT ALL ON TABLE public.company_taskless_stages TO service_role;

COMMENT ON TABLE public.company_taskless_stages IS
  'Etapas de funil incluídas na coluna de leads sem tarefa pendente. Sem policy para o JWT.';

-- Substitui o conjunto da empresa numa transação.
-- Recusa etapa cujo funil não pertence à empresa.
CREATE OR REPLACE FUNCTION public.replace_company_taskless_stages(
  p_company_id uuid,
  p_stage_ids uuid[]
) RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT sid), ARRAY[]::uuid[])
    INTO v_ids
  FROM unnest(COALESCE(p_stage_ids, ARRAY[]::uuid[])) AS sid
  WHERE sid IS NOT NULL;

  IF cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'too_many_stages' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_ids) AS sid
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.funnel_stages fs
      JOIN public.sales_funnels f ON f.id = fs.funnel_id
      WHERE fs.id = sid
        AND f.company_id = p_company_id
    )
  ) THEN
    RAISE EXCEPTION 'stage_not_in_company' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.company_taskless_stages
  WHERE company_id = p_company_id;

  INSERT INTO public.company_taskless_stages (company_id, stage_id)
  SELECT p_company_id, sid
  FROM unnest(v_ids) AS sid;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_company_taskless_stages(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_company_taskless_stages(uuid, uuid[]) FROM anon;
REVOKE ALL ON FUNCTION public.replace_company_taskless_stages(uuid, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.replace_company_taskless_stages(uuid, uuid[]) TO service_role;

-- Posições nas etapas marcadas cujo lead não tem tarefa pending na empresa.
-- p_responsible_user_id nulo = recorte da empresa. Preenchido = só esse responsável.
-- Autorização fica na rota; esta função só é executável por service_role.
CREATE OR REPLACE FUNCTION public.list_taskless_lead_positions(
  p_company_id uuid,
  p_responsible_user_id uuid,
  p_limit integer
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 200);
  v_total integer;
  v_items jsonb;
  v_configured boolean;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.company_taskless_stages WHERE company_id = p_company_id
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
    JOIN public.company_taskless_stages cts
      ON cts.company_id = p_company_id
     AND cts.stage_id = ofp.stage_id
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
    JOIN public.company_taskless_stages cts
      ON cts.company_id = p_company_id
     AND cts.stage_id = ofp.stage_id
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

REVOKE ALL ON FUNCTION public.list_taskless_lead_positions(uuid, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_taskless_lead_positions(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.list_taskless_lead_positions(uuid, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.list_taskless_lead_positions(uuid, uuid, integer) TO service_role;
