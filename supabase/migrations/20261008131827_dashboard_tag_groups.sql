-- Grupos de tags do dashboard comercial.
-- Aditiva: não altera RPCs existentes.
-- Não cria índice. Os índices reais já cobrem o plano escolhido.
--
-- Rollback operacional: tirar VITE_FEATURE_TAG_GROUPS do build da aplicação
-- que deve esconder o card e publicar esse build de novo.
-- A RPC, a coluna e os grupos salvos permanecem.
-- DROP da função ou da coluna não é o rollback padrão.
-- Remoção definitiva só em migration separada, depois de confirmar
-- que não há caller, e com autorização específica.
--
-- Leads no período:
--   idx_leads_company_origin_created
--     btree (company_id, created_at DESC) WHERE deleted_at IS NULL
--   A coluna origin NÃO entra na chave, apesar do nome.
--   idx_leads_company_created_at_active tem a mesma chave.
--   Com vendedor: idx_leads_company_user_created
--     btree (company_id, responsible_user_id, created_at DESC) WHERE deleted_at IS NULL
--
-- Atribuições:
--   unique_lead_tag_assignment btree (lead_id, tag_id)
--   idx_lead_tag_assignments_lead_id btree (lead_id)
--   idx_lead_tag_assignments_tag_id btree (tag_id)
--   Não existe índice (tag_id, lead_id). O plano parte dos leads do período
--   e busca as tags pelo lead_id, então o índice por lead_id atende.
--   Um índice (tag_id, lead_id) só seria criado depois do EXPLAIN,
--   com CREATE INDEX CONCURRENTLY fora desta transação.
--   CREATE INDEX comum dentro da migration toma ShareLock e bloqueia
--   gravações em lead_tag_assignments até o build terminar.
--
-- Oportunidades elegíveis: todas as linhas de public.opportunities
-- do lead e da mesma company_id. A tabela não tem deleted_at nem archived_at.
-- status open, won e lost entram na contagem.
-- Conversão e receita usam somente status = 'won'.
-- closed_at e created_at da oportunidade não filtram a coorte.
-- Diferença em relação a get_dashboard_lead_origins: este RPC também
-- exige opportunities.company_id = p_company_id.
--
-- Responsável do recorte de vendedor: leads.responsible_user_id.
-- Período: timestamptz já resolvido em UTC pelo mesmo resolvePeriod de lead-origins.

ALTER TABLE public.dashboard_alert_settings
  ADD COLUMN IF NOT EXISTS tag_group_settings JSONB NOT NULL
  DEFAULT '{"groups":[]}'::jsonb;

ALTER TABLE public.dashboard_alert_settings
  DROP CONSTRAINT IF EXISTS chk_tag_group_settings;

ALTER TABLE public.dashboard_alert_settings
  ADD CONSTRAINT chk_tag_group_settings CHECK (
    jsonb_typeof(tag_group_settings) = 'object'
    AND jsonb_typeof(tag_group_settings -> 'groups') = 'array'
  );

CREATE OR REPLACE FUNCTION public.get_dashboard_tag_group_metrics(
  p_company_id uuid,
  p_start_date timestamptz,
  p_end_date   timestamptz,
  p_user_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_settings jsonb;
  v_groups   jsonb;
  v_classified jsonb;
  v_has_valid boolean;
  v_tag_ids uuid[];
  v_metrics jsonb;
BEGIN
  IF p_company_id IS NULL
     OR p_start_date IS NULL
     OR p_end_date IS NULL
     OR p_start_date > p_end_date
     OR p_end_date - p_start_date > interval '366 days' THEN
    RAISE EXCEPTION 'parametros invalidos' USING ERRCODE = '22023';
  END IF;

  SELECT das.tag_group_settings
    INTO v_settings
  FROM public.dashboard_alert_settings das
  WHERE das.company_id = p_company_id;

  v_groups := COALESCE(v_settings -> 'groups', '[]'::jsonb);

  IF jsonb_typeof(v_groups) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_groups) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH raw_groups AS (
    SELECT
      item.ordinality::int AS position,
      item.grp ->> 'id' AS group_id,
      item.grp ->> 'name' AS group_name,
      CASE
        WHEN jsonb_typeof(item.grp -> 'tag_ids') = 'array' THEN item.grp -> 'tag_ids'
        ELSE '[]'::jsonb
      END AS tag_ids
    FROM jsonb_array_elements(v_groups) WITH ORDINALITY AS item(grp, ordinality)
  ),
  expanded AS (
    SELECT
      rg.position,
      rg.group_id,
      rg.group_name,
      tag.tag_id,
      (
        tag.tag_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND lt.id IS NOT NULL
        AND lt.company_id = p_company_id
        AND lt.is_active IS TRUE
      ) AS tag_ok
    FROM raw_groups rg
    LEFT JOIN LATERAL jsonb_array_elements_text(rg.tag_ids) AS tag(tag_id) ON TRUE
    LEFT JOIN public.lead_tags lt
      ON lt.company_id = p_company_id
     AND lt.id::text = tag.tag_id
  ),
  classified AS (
    SELECT
      position,
      group_id,
      group_name,
      COALESCE(bool_and(tag_ok) FILTER (WHERE tag_id IS NOT NULL), false) AS is_valid,
      COALESCE(array_agg(tag_id) FILTER (WHERE tag_id IS NOT NULL AND NOT tag_ok), ARRAY[]::text[]) AS invalid_tag_ids,
      COALESCE(array_agg(tag_id::uuid) FILTER (WHERE tag_ok), ARRAY[]::uuid[]) AS valid_tag_ids
    FROM expanded
    GROUP BY position, group_id, group_name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'position', position,
      'group_id', group_id,
      'name', group_name,
      'status', CASE WHEN is_valid THEN 'ok' ELSE 'invalid' END,
      'invalid_tag_ids', to_jsonb(invalid_tag_ids),
      'tag_ids', COALESCE((SELECT jsonb_agg(tid) FROM unnest(valid_tag_ids) AS tid), '[]'::jsonb)
    )
    ORDER BY position
  ), '[]'::jsonb)
  INTO v_classified
  FROM classified;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_classified) g
    WHERE g ->> 'status' = 'ok'
  )
  INTO v_has_valid;

  IF NOT v_has_valid THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'group_id', g ->> 'group_id',
          'name', g ->> 'name',
          'position', (g ->> 'position')::int,
          'status', 'invalid',
          'invalid_tag_ids', g -> 'invalid_tag_ids',
          'lead_count', NULL,
          'opps_generated', NULL,
          'leads_converted', NULL,
          'conversion_rate_pct', NULL,
          'total_won_value', NULL
        )
        ORDER BY (g ->> 'position')::int
      ), '[]'::jsonb)
      FROM jsonb_array_elements(v_classified) g
    );
  END IF;

  SELECT COALESCE(array_agg(DISTINCT tid::uuid), ARRAY[]::uuid[])
    INTO v_tag_ids
  FROM jsonb_array_elements(v_classified) g
  CROSS JOIN LATERAL jsonb_array_elements_text(g -> 'tag_ids') AS tid
  WHERE g ->> 'status' = 'ok';

  WITH valid_groups AS (
    SELECT
      (g ->> 'position')::int AS position,
      g ->> 'group_id' AS group_id,
      g ->> 'name' AS group_name,
      ARRAY(SELECT jsonb_array_elements_text(g -> 'tag_ids'))::uuid[] AS tag_ids
    FROM jsonb_array_elements(v_classified) g
    WHERE g ->> 'status' = 'ok'
  ),
  period_leads AS (
    SELECT l.id
    FROM public.leads l
    WHERE l.company_id = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
  ),
  assigned AS (
    SELECT pl.id AS lead_id, lta.tag_id
    FROM period_leads pl
    JOIN public.lead_tag_assignments lta
      ON lta.lead_id = pl.id
     AND lta.tag_id = ANY(v_tag_ids)
    JOIN public.lead_tags lt
      ON lt.id = lta.tag_id
     AND lt.company_id = p_company_id
  ),
  matched AS (
    SELECT vg.group_id, a.lead_id
    FROM valid_groups vg
    JOIN assigned a ON a.tag_id = ANY(vg.tag_ids)
    GROUP BY vg.group_id, a.lead_id, vg.tag_ids
    HAVING COUNT(DISTINCT a.tag_id) = cardinality(vg.tag_ids)
  ),
  opp AS (
    SELECT
      o.lead_id,
      COUNT(*)::int AS opp_count,
      COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'), 0)::numeric AS won_value,
      BOOL_OR(o.status = 'won') AS has_won
    FROM public.opportunities o
    WHERE o.company_id = p_company_id
      AND o.lead_id IN (SELECT DISTINCT m.lead_id FROM matched m)
    GROUP BY o.lead_id
  ),
  rolled AS (
    SELECT
      vg.position,
      vg.group_id,
      vg.group_name,
      COUNT(m.lead_id)::int AS lead_count,
      COALESCE(SUM(opp.opp_count), 0)::int AS opps_generated,
      COUNT(m.lead_id) FILTER (WHERE opp.has_won)::int AS leads_converted,
      CASE
        WHEN COUNT(m.lead_id) = 0 THEN NULL
        ELSE ROUND(
          (COUNT(m.lead_id) FILTER (WHERE opp.has_won))::numeric
          / COUNT(m.lead_id)::numeric * 100
        , 1)
      END AS conversion_rate_pct,
      COALESCE(SUM(opp.won_value), 0)::numeric AS total_won_value
    FROM valid_groups vg
    LEFT JOIN matched m ON m.group_id = vg.group_id
    LEFT JOIN opp ON opp.lead_id = m.lead_id
    GROUP BY vg.position, vg.group_id, vg.group_name
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'group_id', group_id,
      'name', group_name,
      'position', position,
      'status', 'ok',
      'invalid_tag_ids', '[]'::jsonb,
      'lead_count', lead_count,
      'opps_generated', opps_generated,
      'leads_converted', leads_converted,
      'conversion_rate_pct', conversion_rate_pct,
      'total_won_value', total_won_value
    )
    ORDER BY position
  ), '[]'::jsonb)
  INTO v_metrics
  FROM rolled;

  RETURN (
    SELECT COALESCE(jsonb_agg(row_data ORDER BY position), '[]'::jsonb)
    FROM (
      SELECT
        (g ->> 'position')::int AS position,
        CASE
          WHEN g ->> 'status' = 'invalid' THEN jsonb_build_object(
            'group_id', g ->> 'group_id',
            'name', g ->> 'name',
            'position', (g ->> 'position')::int,
            'status', 'invalid',
            'invalid_tag_ids', g -> 'invalid_tag_ids',
            'lead_count', NULL,
            'opps_generated', NULL,
            'leads_converted', NULL,
            'conversion_rate_pct', NULL,
            'total_won_value', NULL
          )
          ELSE metric.row_data
        END AS row_data
      FROM jsonb_array_elements(v_classified) g
      LEFT JOIN LATERAL (
        SELECT m.row_data
        FROM jsonb_array_elements(v_metrics) AS m(row_data)
        WHERE m.row_data ->> 'group_id' = g ->> 'group_id'
      ) metric ON TRUE
    ) merged
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) TO service_role;

COMMENT ON FUNCTION public.get_dashboard_tag_group_metrics IS
  'Métricas dos grupos de tags da empresa. Coorte: leads.created_at no período, deleted_at nulo, responsible_user_id opcional. '
  'O lead entra no grupo somente se tiver todas as tags. Oportunidades da mesma empresa, sem filtro pela data da venda.';
