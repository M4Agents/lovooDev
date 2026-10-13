-- Configuração da coluna "Leads sem tarefas" por usuário e empresa.
-- A tabela company_taskless_stages deixa de ser lida; o conjunto de etapas
-- e o período passam a ser pessoais. O JWT não acessa estas tabelas.

CREATE TABLE public.user_taskless_preferences (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period_type text NOT NULL DEFAULT '30days',
  custom_start date,
  custom_end date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id),
  CONSTRAINT user_taskless_preferences_period_check CHECK (
    period_type IN (
      'today', 'yesterday', '7days', '15days', '30days',
      'this_month', 'last_month', '90days', 'this_quarter', 'this_year', 'custom'
    )
  ),
  CONSTRAINT user_taskless_preferences_custom_check CHECK (
    (
      period_type = 'custom'
      AND custom_start IS NOT NULL
      AND custom_end IS NOT NULL
      AND custom_start <= custom_end
    )
    OR (
      period_type <> 'custom'
      AND custom_start IS NULL
      AND custom_end IS NULL
    )
  )
);

CREATE TABLE public.user_taskless_stages (
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.funnel_stages(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, stage_id)
);

CREATE INDEX user_taskless_stages_stage_id_idx
  ON public.user_taskless_stages (stage_id);

ALTER TABLE public.user_taskless_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_taskless_stages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_taskless_preferences FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.user_taskless_stages FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_taskless_preferences TO service_role;
GRANT ALL ON TABLE public.user_taskless_stages TO service_role;

COMMENT ON TABLE public.user_taskless_preferences IS
  'Período pessoal da coluna de leads sem tarefa. Sem policy para o JWT.';
COMMENT ON TABLE public.user_taskless_stages IS
  'Etapas pessoais da coluna de leads sem tarefa. Sem policy para o JWT.';

CREATE OR REPLACE FUNCTION public.replace_user_taskless_config(
  p_company_id uuid,
  p_user_id uuid,
  p_stage_ids uuid[],
  p_period_type text,
  p_custom_start date,
  p_custom_end date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_start date;
  v_end date;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_required' USING ERRCODE = '22023';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_required' USING ERRCODE = '22023';
  END IF;
  IF p_period_type IS NULL OR p_period_type NOT IN (
    'today', 'yesterday', '7days', '15days', '30days',
    'this_month', 'last_month', '90days', 'this_quarter', 'this_year', 'custom'
  ) THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023';
  END IF;

  IF p_period_type = 'custom' THEN
    IF p_custom_start IS NULL OR p_custom_end IS NULL OR p_custom_start > p_custom_end THEN
      RAISE EXCEPTION 'invalid_custom_period' USING ERRCODE = '22023';
    END IF;
    v_start := p_custom_start;
    v_end := p_custom_end;
  ELSE
    v_start := NULL;
    v_end := NULL;
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

  INSERT INTO public.user_taskless_preferences (
    company_id, user_id, period_type, custom_start, custom_end, updated_at
  ) VALUES (
    p_company_id, p_user_id, p_period_type, v_start, v_end, now()
  )
  ON CONFLICT (company_id, user_id) DO UPDATE
    SET period_type = EXCLUDED.period_type,
        custom_start = EXCLUDED.custom_start,
        custom_end = EXCLUDED.custom_end,
        updated_at = now();

  DELETE FROM public.user_taskless_stages
  WHERE company_id = p_company_id
    AND user_id = p_user_id;

  INSERT INTO public.user_taskless_stages (company_id, user_id, stage_id)
  SELECT p_company_id, p_user_id, sid
  FROM unnest(v_ids) AS sid;

  RETURN jsonb_build_object(
    'stage_ids', to_jsonb(v_ids),
    'period_type', p_period_type,
    'custom_start', v_start,
    'custom_end', v_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_taskless_config(uuid, uuid, uuid[], text, date, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_taskless_config(uuid, uuid, uuid[], text, date, date)
  TO service_role;

DROP FUNCTION IF EXISTS public.list_taskless_lead_positions(uuid, uuid, integer);

-- p_from inclusive, p_to exclusivo, já calculados no fuso da empresa.
-- p_responsible_user_id nulo = recorte da empresa. Preenchido = só esse responsável.
CREATE OR REPLACE FUNCTION public.list_taskless_lead_positions(
  p_company_id uuid,
  p_user_id uuid,
  p_responsible_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
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

REVOKE ALL ON FUNCTION public.list_taskless_lead_positions(uuid, uuid, uuid, timestamptz, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_taskless_lead_positions(uuid, uuid, uuid, timestamptz, timestamptz, integer)
  TO service_role;
