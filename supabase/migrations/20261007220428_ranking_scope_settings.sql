-- Escopo do Ranking Comercial por empresa.
-- Padrão: todos os funis e todas as etapas ativas.
-- Ganhou e Perdeu não entram em Leads, Atend., T. Resp. e SLA.
-- Esses fechamentos continuam em Conversão e Receita.

ALTER TABLE public.dashboard_alert_settings
  ADD COLUMN IF NOT EXISTS ranking_scope_settings JSONB NOT NULL
  DEFAULT '{"mode":"all"}'::jsonb;

ALTER TABLE public.dashboard_alert_settings
  DROP CONSTRAINT IF EXISTS chk_ranking_scope_settings;

ALTER TABLE public.dashboard_alert_settings
  ADD CONSTRAINT chk_ranking_scope_settings CHECK (
    jsonb_typeof(ranking_scope_settings) = 'object'
    AND ranking_scope_settings ? 'mode'
    AND ranking_scope_settings->>'mode' IN ('all', 'custom')
  );

CREATE OR REPLACE FUNCTION get_dashboard_seller_ranking(
  p_company_id      UUID,
  p_start_date      TIMESTAMPTZ,
  p_end_date        TIMESTAMPTZ,
  p_user_id         UUID    DEFAULT NULL,
  p_include_ranking BOOLEAN DEFAULT TRUE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSON;
  v_settings   JSONB;
  v_mode       TEXT;
  v_funnel_ids UUID[];
  v_stage_ids  UUID[];
BEGIN
  SELECT COALESCE(das.ranking_scope_settings, '{"mode":"all"}'::jsonb)
  INTO v_settings
  FROM dashboard_alert_settings das
  WHERE das.company_id = p_company_id;

  IF v_settings IS NULL THEN
    v_settings := '{"mode":"all"}'::jsonb;
  END IF;

  v_mode := COALESCE(v_settings->>'mode', 'all');
  IF v_mode NOT IN ('all', 'custom') THEN
    v_mode := 'all';
  END IF;

  IF v_mode = 'custom'
     AND jsonb_typeof(v_settings->'funnel_ids') = 'array'
     AND jsonb_typeof(v_settings->'stage_ids') = 'array' THEN
    SELECT COALESCE(array_agg(DISTINCT t.x::uuid), '{}')
    INTO v_funnel_ids
    FROM jsonb_array_elements_text(v_settings->'funnel_ids') AS t(x)
    WHERE t.x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    SELECT COALESCE(array_agg(DISTINCT t.x::uuid), '{}')
    INTO v_stage_ids
    FROM jsonb_array_elements_text(v_settings->'stage_ids') AS t(x)
    WHERE t.x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  ELSE
    v_funnel_ids := NULL;
    v_stage_ids := NULL;
    IF v_mode = 'custom' THEN
      v_funnel_ids := '{}';
      v_stage_ids := '{}';
    END IF;
  END IF;

  WITH
  active_sellers AS (
    SELECT
      cu.user_id,
      COALESCE(
        au.raw_user_meta_data->>'name',
        au.raw_user_meta_data->>'full_name',
        split_part(au.email::text, '@', 1),
        cu.user_id::TEXT
      ) AS display_name
    FROM company_users cu
    LEFT JOIN auth.users au ON au.id = cu.user_id
    WHERE cu.company_id = p_company_id
      AND cu.is_active  = true
      AND cu.role       IN ('seller', 'manager', 'admin')
      AND (p_user_id IS NULL OR cu.user_id = p_user_id)
  ),

  scoped_leads AS (
    SELECT DISTINCT l.id, l.responsible_user_id
    FROM leads l
    JOIN opportunities o
      ON o.lead_id = l.id
     AND o.company_id = p_company_id
    JOIN opportunity_funnel_positions ofp
      ON ofp.opportunity_id = o.id
    JOIN funnel_stages fs
      ON fs.id = ofp.stage_id
     AND fs.funnel_id = ofp.funnel_id
    JOIN sales_funnels sf
      ON sf.id = ofp.funnel_id
     AND sf.company_id = p_company_id
    WHERE l.company_id = p_company_id
      AND l.deleted_at IS NULL
      AND l.created_at >= p_start_date
      AND l.created_at <= p_end_date
      AND fs.stage_type = 'active'
      AND (
        v_mode = 'all'
        OR (ofp.funnel_id = ANY(v_funnel_ids) AND fs.id = ANY(v_stage_ids))
      )
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
  ),

  leads_metrics AS (
    SELECT
      sl.responsible_user_id     AS user_id,
      COUNT(DISTINCT sl.id)::INT AS leads_received
    FROM scoped_leads sl
    GROUP BY 1
  ),

  opp_metrics AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.created_at >= p_start_date AND o.created_at <= p_end_date
      )::INT AS opps_generated,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status = 'won'
      )::INT AS opps_won,
      COUNT(DISTINCT o.id) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status IN ('won', 'lost')
      )::INT AS opps_closed,
      COALESCE(SUM(o.value) FILTER (
        WHERE o.closed_at >= p_start_date AND o.closed_at <= p_end_date AND o.status = 'won'
      ), 0) AS won_value
    FROM leads l
    JOIN opportunities o
      ON o.lead_id = l.id
     AND o.company_id = p_company_id
    WHERE l.company_id = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
      AND (
        v_mode = 'all'
        OR EXISTS (
          SELECT 1
          FROM opportunity_funnel_positions ofp
          JOIN sales_funnels sf
            ON sf.id = ofp.funnel_id
           AND sf.company_id = p_company_id
          WHERE ofp.opportunity_id = o.id
            AND ofp.funnel_id = ANY(v_funnel_ids)
        )
      )
    GROUP BY 1
  ),

  first_inbound AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction   = 'inbound'
      AND cm.created_at >= p_start_date
      AND cm.created_at <= p_end_date
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),

  first_human_response AS (
    SELECT DISTINCT ON (fi.conversation_id)
      fi.conversation_id,
      EXTRACT(EPOCH FROM (cm.created_at - fi.first_in_at)) / 60.0 AS response_min
    FROM first_inbound fi
    JOIN chat_messages cm
      ON  cm.conversation_id = fi.conversation_id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > fi.first_in_at
    ORDER BY fi.conversation_id, cm.created_at ASC
  ),

  attendance_metrics AS (
    SELECT
      l.responsible_user_id                    AS user_id,
      COUNT(DISTINCT fhr.conversation_id)::INT AS leads_attended,
      ROUND(AVG(fhr.response_min)::NUMERIC, 1) AS avg_response_min
    FROM first_human_response fhr
    JOIN chat_conversations cc ON cc.id = fhr.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    JOIN scoped_leads sl       ON sl.id = l.id
    WHERE l.company_id = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  sla_missed_convs AS (
    SELECT fi.conversation_id
    FROM first_inbound fi
    LEFT JOIN first_human_response fhr ON fhr.conversation_id = fi.conversation_id
    WHERE fhr.conversation_id IS NULL
  ),

  sla_metrics AS (
    SELECT
      l.responsible_user_id                    AS user_id,
      COUNT(DISTINCT smc.conversation_id)::INT AS sla_missed_count
    FROM sla_missed_convs smc
    JOIN chat_conversations cc ON cc.id = smc.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    JOIN scoped_leads sl       ON sl.id = l.id
    WHERE l.company_id = p_company_id
      AND l.deleted_at IS NULL
      AND (p_user_id IS NULL OR l.responsible_user_id = p_user_id)
    GROUP BY 1
  ),

  combined AS (
    SELECT
      s.user_id,
      s.display_name,
      COALESCE(lm.leads_received,   0) AS leads_received,
      COALESCE(am.leads_attended,   0) AS leads_attended,
      am.avg_response_min,
      COALESCE(om.opps_generated,   0) AS opps_generated,
      COALESCE(om.opps_won,         0) AS opps_won,
      COALESCE(om.opps_closed,      0) AS opps_closed,
      COALESCE(om.won_value,        0) AS won_value,
      COALESCE(sm.sla_missed_count, 0) AS sla_missed_count
    FROM active_sellers s
    LEFT JOIN leads_metrics lm      ON lm.user_id = s.user_id
    LEFT JOIN opp_metrics om        ON om.user_id = s.user_id
    LEFT JOIN attendance_metrics am ON am.user_id = s.user_id
    LEFT JOIN sla_metrics sm        ON sm.user_id = s.user_id
    WHERE COALESCE(lm.leads_received, 0) > 0
       OR COALESCE(om.opps_closed, 0) > 0
       OR COALESCE(om.opps_generated, 0) > 0
       OR COALESCE(om.won_value, 0) > 0
  ),

  norm AS (
    SELECT *,
      MAX(COALESCE(avg_response_min, 0)) OVER () AS max_response,
      MAX(opps_generated)               OVER () AS max_opps
    FROM combined
  ),

  scored AS (
    SELECT
      user_id,
      display_name,
      leads_received,
      leads_attended,
      avg_response_min,
      opps_generated,
      opps_won,
      opps_closed,
      won_value,
      sla_missed_count,
      ROUND(COALESCE(leads_attended::NUMERIC   / NULLIF(leads_received, 0), 0),   3) AS attendance_rate,
      ROUND(COALESCE(opps_won::NUMERIC         / NULLIF(opps_closed,    0), 0.5), 3) AS conversion_rate,
      ROUND(COALESCE(sla_missed_count::NUMERIC / NULLIF(leads_received, 0), 0),   3) AS sla_missed_rate,
      CASE WHEN p_include_ranking THEN
        ROUND((
          0.35 * COALESCE(opps_won::NUMERIC / NULLIF(opps_closed, 0), 0.5)
        + 0.25 * CASE
                   WHEN avg_response_min IS NULL THEN 0
                   WHEN max_response > 0         THEN 1.0 - (avg_response_min / max_response)
                   ELSE 1.0
                 END
        + 0.20 * COALESCE(leads_attended::NUMERIC / NULLIF(leads_received, 0), 0)
        + 0.10 * CASE WHEN max_opps > 0 THEN opps_generated::NUMERIC / max_opps ELSE 0 END
        + 0.10 * GREATEST(1.0 - COALESCE(sla_missed_count::NUMERIC / NULLIF(leads_received, 0), 0), 0)
        ) * 100, 1)
      ELSE NULL
      END AS score
    FROM norm
  )

  SELECT json_agg(row_to_json(t) ORDER BY COALESCE(t.score, -1) DESC)
  INTO   v_result
  FROM (
    SELECT
      scored.*,
      CASE WHEN p_include_ranking AND score IS NOT NULL
           THEN ROW_NUMBER() OVER (ORDER BY score DESC NULLS LAST)
           ELSE NULL
      END AS rank
    FROM scored
  ) t;

  RETURN COALESCE(v_result, '[]'::JSON);
END;
$$;

REVOKE EXECUTE ON FUNCTION get_dashboard_seller_ranking(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, BOOLEAN) FROM PUBLIC;
