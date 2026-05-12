-- =====================================================
-- FASE 4.0 — Snapshot Executivo Histórico
-- Migration 3/3: generate_dashboard_daily_snapshot
--
-- Gera (ou regenera via UPSERT) o snapshot de UMA empresa
-- para UMA data específica.
--
-- ANTI-DRIFT (contrato obrigatório):
--   A lógica matemática aqui DEVE permanecer sincronizada com:
--     • get_dashboard_forecast        → pipeline, buckets, won/lost
--     • get_dashboard_funnel_executive → etapas, stalled, avg_days
--     • get_dashboard_sla_alerts       → sla_breached_count, avg_response
--     • get_dashboard_seller_ranking   → seller metrics
--
--   Ao alterar qualquer RPC de realtime acima, revisar se
--   generate_dashboard_daily_snapshot precisa ser atualizado.
--   Incrementar snapshot_version quando a fórmula mudar.
--
-- Idempotente: upsert via ON CONFLICT DO UPDATE.
-- Chamado pelo cron para D-1, D-2 e D-3.
-- Chamado pelo backfill para qualquer data histórica.
--
-- Retorno: JSON { ok, upserted_company, upserted_stages,
--                 upserted_sellers, funnel_id, date }
-- =====================================================

CREATE OR REPLACE FUNCTION generate_dashboard_daily_snapshot(
  p_company_id UUID,
  p_date       DATE
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start    DATE        := p_date;
  v_period_end      DATE        := p_date;
  v_day_start       TIMESTAMPTZ := p_date::TIMESTAMPTZ AT TIME ZONE 'UTC';
  v_day_end         TIMESTAMPTZ := (p_date + 1)::TIMESTAMPTZ AT TIME ZONE 'UTC';
  v_stalled_days    INT         := 14;
  v_funnel          RECORD;
  v_upserted_stages INT         := 0;
  v_upserted_sellers INT        := 0;
  v_default_funnel_id UUID;

  -- Métricas company-wide
  v_leads_created          INT;
  v_convs_started          INT;
  v_convs_attended         INT;
  v_sla_breached           INT;
  v_avg_response_min       NUMERIC;
  v_won_count              INT;
  v_won_value              NUMERIC;
  v_lost_count             INT;
  v_lost_value             NUMERIC;

  -- Métricas de pipeline (STATE — snapshot do fim do dia)
  v_pipeline_total         NUMERIC;
  v_pipeline_weighted      NUMERIC;
  v_pipeline_risk          NUMERIC;
  v_open_count             INT;
  v_stalled_count          INT;
  v_hot_count              INT;
  v_conversion_rate        NUMERIC;
  v_prob_0_20              NUMERIC;
  v_prob_21_40             NUMERIC;
  v_prob_41_60             NUMERIC;
  v_prob_61_80             NUMERIC;
  v_prob_81_100            NUMERIC;
  v_funnel_stages_cache    JSONB;

  v_result JSON;
BEGIN

  -- ── 1. FLOW METRICS: leads criados no dia ──────────────────────────────
  SELECT COUNT(*)::INT
  INTO   v_leads_created
  FROM   leads
  WHERE  company_id = p_company_id
    AND  deleted_at IS NULL
    AND  created_at >= v_day_start
    AND  created_at <  v_day_end;

  -- ── 2. FLOW METRICS: conversas iniciadas no dia ────────────────────────
  SELECT COUNT(*)::INT
  INTO   v_convs_started
  FROM   chat_conversations
  WHERE  company_id = p_company_id
    AND  created_at >= v_day_start
    AND  created_at <  v_day_end;

  -- ── 3. FLOW METRICS: conversas atendidas (primeira resposta humana) ────
  -- Conta conversas com primeiro inbound no dia E que tiveram resposta humana
  WITH first_inbound_day AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM   chat_messages cm
    WHERE  cm.company_id = p_company_id
      AND  cm.direction  = 'inbound'
      AND  cm.created_at >= v_day_start
      AND  cm.created_at <  v_day_end
    ORDER BY cm.conversation_id, cm.created_at ASC
  )
  SELECT COUNT(DISTINCT fi.conversation_id)::INT
  INTO   v_convs_attended
  FROM   first_inbound_day fi
  WHERE EXISTS (
    SELECT 1
    FROM   chat_messages cm2
    WHERE  cm2.conversation_id  = fi.conversation_id
      AND  cm2.company_id       = p_company_id
      AND  cm2.direction        = 'outbound'
      AND  cm2.is_ai_generated  = false
      AND  cm2.created_at       > fi.first_in_at
  );

  -- ── 4. FLOW METRICS: SLA breached no dia ──────────────────────────────
  -- Conversas cujo PRIMEIRO inbound foi no dia e NÃO tiveram resposta humana
  WITH first_inbound_day AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM   chat_messages cm
    WHERE  cm.company_id = p_company_id
      AND  cm.direction  = 'inbound'
      AND  cm.created_at >= v_day_start
      AND  cm.created_at <  v_day_end
    ORDER BY cm.conversation_id, cm.created_at ASC
  )
  SELECT COUNT(DISTINCT fi.conversation_id)::INT
  INTO   v_sla_breached
  FROM   first_inbound_day fi
  WHERE NOT EXISTS (
    SELECT 1
    FROM   chat_messages cm2
    WHERE  cm2.conversation_id  = fi.conversation_id
      AND  cm2.company_id       = p_company_id
      AND  cm2.direction        = 'outbound'
      AND  cm2.is_ai_generated  = false
      AND  cm2.created_at       > fi.first_in_at
  );

  -- ── 5. FLOW METRICS: média de resposta do dia ──────────────────────────
  WITH first_inbound_day AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id,
      cm.created_at AS first_in_at
    FROM   chat_messages cm
    WHERE  cm.company_id = p_company_id
      AND  cm.direction  = 'inbound'
      AND  cm.created_at >= v_day_start
      AND  cm.created_at <  v_day_end
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),
  first_human_resp AS (
    SELECT DISTINCT ON (fi.conversation_id)
      fi.conversation_id,
      EXTRACT(EPOCH FROM (cm.created_at - fi.first_in_at)) / 60.0 AS resp_min
    FROM   first_inbound_day fi
    JOIN   chat_messages cm
      ON   cm.conversation_id = fi.conversation_id
      AND  cm.company_id      = p_company_id
      AND  cm.direction       = 'outbound'
      AND  cm.is_ai_generated = false
      AND  cm.created_at      > fi.first_in_at
    ORDER BY fi.conversation_id, cm.created_at ASC
  )
  SELECT ROUND(COALESCE(AVG(resp_min), 0)::NUMERIC, 1)
  INTO   v_avg_response_min
  FROM   first_human_resp;

  -- ── 6. FLOW METRICS: ganhos e perdas fechados no dia ──────────────────
  SELECT
    COALESCE(SUM(CASE WHEN o.status = 'won'  THEN 1 ELSE 0 END), 0)::INT,
    COALESCE(SUM(CASE WHEN o.status = 'won'  THEN COALESCE(o.value, 0) ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END), 0)::INT,
    COALESCE(SUM(CASE WHEN o.status = 'lost' THEN COALESCE(o.value, 0) ELSE 0 END), 0)
  INTO v_won_count, v_won_value, v_lost_count, v_lost_value
  FROM  opportunities o
  JOIN  leads l ON l.id = o.lead_id
  WHERE o.company_id  = p_company_id
    AND l.company_id  = p_company_id
    AND l.deleted_at  IS NULL
    AND o.closed_at  >= v_day_start
    AND o.closed_at  <  v_day_end;

  -- ── 7. STATE METRICS: pipeline aberto ao final do dia ─────────────────
  -- "Ao final do dia" = estado em p_date às 23:59:59 UTC
  -- Usamos o estado ATUAL das oportunidades se p_date = hoje,
  -- ou o estado histórico para datas passadas (sem time-travel nativo).
  -- Para simplificar (sem event sourcing): usamos o estado atual
  -- filtrado por oportunidades abertas criadas até o fim do dia.
  SELECT
    COALESCE(SUM(COALESCE(o.value, 0)), 0),
    COALESCE(SUM(COALESCE(o.value, 0) * COALESCE(o.probability, 0) / 100.0), 0),
    COUNT(*)::INT,
    COUNT(*) FILTER (
      WHERE o.last_interaction_at IS NULL
         OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days)
    )::INT,
    COUNT(*) FILTER (WHERE COALESCE(o.probability, 0) >= 70)::INT,
    -- Buckets de probabilidade
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN  0 AND  20), 0),
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 21 AND  40), 0),
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 41 AND  60), 0),
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 61 AND  80), 0),
    COALESCE(SUM(COALESCE(o.value, 0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 81 AND 100), 0)
  INTO
    v_pipeline_total, v_pipeline_weighted, v_open_count,
    v_stalled_count,  v_hot_count,
    v_prob_0_20, v_prob_21_40, v_prob_41_60, v_prob_61_80, v_prob_81_100
  FROM opportunities o
  JOIN leads l ON l.id = o.lead_id
  WHERE o.company_id  = p_company_id
    AND l.company_id  = p_company_id
    AND l.deleted_at  IS NULL
    AND o.status      = 'open'
    AND o.created_at  < v_day_end;

  -- pipeline_risk = valor ponderado das oportunidades paradas
  SELECT COALESCE(SUM(COALESCE(o.value, 0) * COALESCE(o.probability, 0) / 100.0), 0)
  INTO   v_pipeline_risk
  FROM   opportunities o
  JOIN   leads l ON l.id = o.lead_id
  WHERE  o.company_id  = p_company_id
    AND  l.company_id  = p_company_id
    AND  l.deleted_at  IS NULL
    AND  o.status      = 'open'
    AND  o.created_at  < v_day_end
    AND (o.last_interaction_at IS NULL
         OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days));

  -- conversion_rate no dia
  v_conversion_rate := CASE
    WHEN (v_won_count + v_lost_count) = 0 THEN 0
    ELSE ROUND(v_won_count::NUMERIC / (v_won_count + v_lost_count) * 100, 1)
  END;

  -- ── 8. STATE METRICS: funil padrão — etapas e cache JSONB ─────────────
  SELECT sf.id
  INTO   v_default_funnel_id
  FROM   sales_funnels sf
  WHERE  sf.company_id = p_company_id
    AND  sf.is_active  = true
  ORDER BY sf.is_default DESC, sf.created_at ASC
  LIMIT 1;

  -- UPSERT company-wide snapshot (funnel_id = NULL)
  INSERT INTO dashboard_snapshots (
    company_id, funnel_id,
    period_start, period_end,
    -- FLOW
    leads_created, conversations_started, conversations_attended,
    won_count, won_value, lost_count, lost_value, sla_breached_count,
    -- STATE
    pipeline_total, pipeline_weighted, pipeline_risk,
    open_count, stalled_count, hot_count,
    avg_response_minutes, conversion_rate,
    -- FORECAST BUCKETS
    prob_0_20_value, prob_21_40_value, prob_41_60_value,
    prob_61_80_value, prob_81_100_value,
    -- CACHE
    funnel_stages_cache,
    snapshot_taken_at
  ) VALUES (
    p_company_id, NULL,
    v_period_start, v_period_end,
    v_leads_created, v_convs_started, v_convs_attended,
    v_won_count, v_won_value, v_lost_count, v_lost_value, v_sla_breached,
    v_pipeline_total, v_pipeline_weighted, v_pipeline_risk,
    v_open_count, v_stalled_count, v_hot_count,
    v_avg_response_min, v_conversion_rate,
    v_prob_0_20, v_prob_21_40, v_prob_41_60, v_prob_61_80, v_prob_81_100,
    NULL, -- funnel_stages_cache: preenchido abaixo se houver funil
    now()
  )
  ON CONFLICT ON CONSTRAINT uq_dashboard_snapshots
  DO UPDATE SET
    leads_created         = EXCLUDED.leads_created,
    conversations_started = EXCLUDED.conversations_started,
    conversations_attended= EXCLUDED.conversations_attended,
    won_count             = EXCLUDED.won_count,
    won_value             = EXCLUDED.won_value,
    lost_count            = EXCLUDED.lost_count,
    lost_value            = EXCLUDED.lost_value,
    sla_breached_count    = EXCLUDED.sla_breached_count,
    pipeline_total        = EXCLUDED.pipeline_total,
    pipeline_weighted     = EXCLUDED.pipeline_weighted,
    pipeline_risk         = EXCLUDED.pipeline_risk,
    open_count            = EXCLUDED.open_count,
    stalled_count         = EXCLUDED.stalled_count,
    hot_count             = EXCLUDED.hot_count,
    avg_response_minutes  = EXCLUDED.avg_response_minutes,
    conversion_rate       = EXCLUDED.conversion_rate,
    prob_0_20_value       = EXCLUDED.prob_0_20_value,
    prob_21_40_value      = EXCLUDED.prob_21_40_value,
    prob_41_60_value      = EXCLUDED.prob_41_60_value,
    prob_61_80_value      = EXCLUDED.prob_61_80_value,
    prob_81_100_value     = EXCLUDED.prob_81_100_value,
    snapshot_taken_at     = now();

  -- ── 9. Snapshots por funil (etapas + JSONB cache) ─────────────────────
  FOR v_funnel IN
    SELECT sf.id AS funnel_id
    FROM   sales_funnels sf
    WHERE  sf.company_id = p_company_id
      AND  sf.is_active  = true
  LOOP
    -- Coletar dados de etapas
    WITH stage_opps AS (
      SELECT
        ofp.stage_id,
        COUNT(*)::INT                                                   AS opp_count,
        ROUND(COALESCE(SUM(o.value), 0)::NUMERIC, 2)                   AS total_value,
        ROUND(COALESCE(SUM(o.value * o.probability / 100.0), 0)::NUMERIC, 2) AS weighted_value,
        COUNT(*) FILTER (
          WHERE o.last_interaction_at IS NULL
             OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days)
        )::INT AS stalled_count
      FROM opportunity_funnel_positions ofp
      JOIN opportunities o ON o.id   = ofp.opportunity_id
      JOIN leads l         ON l.id   = o.lead_id
      WHERE ofp.funnel_id  = v_funnel.funnel_id
        AND o.company_id   = p_company_id
        AND o.status       = 'open'
        AND l.deleted_at   IS NULL
        AND o.created_at   < v_day_end
      GROUP BY ofp.stage_id
    ),
    stage_avg AS (
      SELECT
        osh.to_stage_id AS stage_id,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (COALESCE(osh.stage_left_at, now()) - osh.stage_entered_at)) / 86400.0
        )::NUMERIC, 1) AS avg_days
      FROM opportunity_stage_history osh
      WHERE osh.funnel_id   = v_funnel.funnel_id
        AND osh.company_id  = p_company_id
      GROUP BY osh.to_stage_id
    )
    INSERT INTO dashboard_funnel_stage_snapshots (
      company_id, funnel_id, stage_id, period_start,
      opp_count, total_value, weighted_value, stalled_count, avg_days,
      snapshot_taken_at
    )
    SELECT
      p_company_id, v_funnel.funnel_id, fs.id, v_period_start,
      COALESCE(so.opp_count,      0),
      COALESCE(so.total_value,    0),
      COALESCE(so.weighted_value, 0),
      COALESCE(so.stalled_count,  0),
      COALESCE(sa.avg_days,       0),
      now()
    FROM   funnel_stages fs
    LEFT JOIN stage_opps so ON so.stage_id = fs.id
    LEFT JOIN stage_avg  sa ON sa.stage_id = fs.id
    WHERE  fs.funnel_id  = v_funnel.funnel_id
      AND  fs.is_hidden  = false
    ON CONFLICT ON CONSTRAINT uq_funnel_stage_snapshots
    DO UPDATE SET
      opp_count      = EXCLUDED.opp_count,
      total_value    = EXCLUDED.total_value,
      weighted_value = EXCLUDED.weighted_value,
      stalled_count  = EXCLUDED.stalled_count,
      avg_days       = EXCLUDED.avg_days,
      snapshot_taken_at = now();

    GET DIAGNOSTICS v_upserted_stages = ROW_COUNT;

    -- Construir JSONB cache do funil para o snapshot principal
    SELECT json_agg(json_build_object(
      'stage_id',       dfs.stage_id,
      'stage_name',     fs.name,
      'position',       fs.position,
      'color',          fs.color,
      'opp_count',      dfs.opp_count,
      'total_value',    dfs.total_value,
      'weighted_value', dfs.weighted_value,
      'stalled_count',  dfs.stalled_count,
      'avg_days',       dfs.avg_days
    ) ORDER BY fs.position)::JSONB
    INTO v_funnel_stages_cache
    FROM dashboard_funnel_stage_snapshots dfs
    JOIN funnel_stages fs ON fs.id = dfs.stage_id
    WHERE dfs.company_id  = p_company_id
      AND dfs.funnel_id   = v_funnel.funnel_id
      AND dfs.period_start = v_period_start;

    -- UPSERT snapshot por funil (com pipeline específico desse funil)
    INSERT INTO dashboard_snapshots (
      company_id, funnel_id, period_start, period_end,
      -- FLOW (mesmo da empresa — não filtramos por funil no flow)
      leads_created, conversations_started, conversations_attended,
      won_count, won_value, lost_count, lost_value, sla_breached_count,
      -- STATE (pipeline deste funil)
      pipeline_total, pipeline_weighted, pipeline_risk,
      open_count, stalled_count, hot_count,
      avg_response_minutes, conversion_rate,
      prob_0_20_value, prob_21_40_value, prob_41_60_value,
      prob_61_80_value, prob_81_100_value,
      funnel_stages_cache, snapshot_taken_at
    )
    SELECT
      p_company_id, v_funnel.funnel_id, v_period_start, v_period_end,
      v_leads_created, v_convs_started, v_convs_attended,
      -- Won/lost filtrado pelo funil
      COALESCE(SUM(CASE WHEN o.status = 'won'  THEN 1 ELSE 0 END), 0)::INT,
      COALESCE(SUM(CASE WHEN o.status = 'won'  THEN COALESCE(o.value,0) ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN o.status = 'lost' THEN 1 ELSE 0 END), 0)::INT,
      COALESCE(SUM(CASE WHEN o.status = 'lost' THEN COALESCE(o.value,0) ELSE 0 END), 0),
      v_sla_breached,
      -- Pipeline deste funil
      COALESCE(SUM(COALESCE(o.value,0)), 0),
      COALESCE(SUM(COALESCE(o.value,0) * COALESCE(o.probability,0) / 100.0), 0),
      COALESCE(SUM(COALESCE(o.value,0) * COALESCE(o.probability,0) / 100.0) FILTER (
        WHERE o.last_interaction_at IS NULL
           OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days)
      ), 0),
      COUNT(*)::INT,
      COUNT(*) FILTER (
        WHERE o.last_interaction_at IS NULL
           OR o.last_interaction_at < v_day_end - make_interval(days => v_stalled_days)
      )::INT,
      COUNT(*) FILTER (WHERE COALESCE(o.probability,0) >= 70)::INT,
      v_avg_response_min, v_conversion_rate,
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN  0 AND  20), 0),
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 21 AND  40), 0),
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 41 AND  60), 0),
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 61 AND  80), 0),
      COALESCE(SUM(COALESCE(o.value,0)) FILTER (WHERE COALESCE(o.probability,0) BETWEEN 81 AND 100), 0),
      v_funnel_stages_cache,
      now()
    FROM opportunities o
    JOIN leads l ON l.id = o.lead_id
    LEFT JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id  = p_company_id
      AND l.company_id  = p_company_id
      AND l.deleted_at  IS NULL
      AND (o.status = 'open' OR (
        o.status IN ('won','lost')
        AND o.closed_at >= v_day_start
        AND o.closed_at <  v_day_end
      ))
      AND (ofp.funnel_id = v_funnel.funnel_id OR ofp.funnel_id IS NULL)
    ON CONFLICT ON CONSTRAINT uq_dashboard_snapshots
    DO UPDATE SET
      leads_created          = EXCLUDED.leads_created,
      conversations_started  = EXCLUDED.conversations_started,
      conversations_attended = EXCLUDED.conversations_attended,
      won_count              = EXCLUDED.won_count,
      won_value              = EXCLUDED.won_value,
      lost_count             = EXCLUDED.lost_count,
      lost_value             = EXCLUDED.lost_value,
      sla_breached_count     = EXCLUDED.sla_breached_count,
      pipeline_total         = EXCLUDED.pipeline_total,
      pipeline_weighted      = EXCLUDED.pipeline_weighted,
      pipeline_risk          = EXCLUDED.pipeline_risk,
      open_count             = EXCLUDED.open_count,
      stalled_count          = EXCLUDED.stalled_count,
      hot_count              = EXCLUDED.hot_count,
      avg_response_minutes   = EXCLUDED.avg_response_minutes,
      conversion_rate        = EXCLUDED.conversion_rate,
      prob_0_20_value        = EXCLUDED.prob_0_20_value,
      prob_21_40_value       = EXCLUDED.prob_21_40_value,
      prob_41_60_value       = EXCLUDED.prob_41_60_value,
      prob_61_80_value       = EXCLUDED.prob_61_80_value,
      prob_81_100_value      = EXCLUDED.prob_81_100_value,
      funnel_stages_cache    = EXCLUDED.funnel_stages_cache,
      snapshot_taken_at      = now();

  END LOOP;

  -- ── 10. Seller snapshots ───────────────────────────────────────────────
  INSERT INTO dashboard_seller_snapshots (
    company_id, user_id, period_start, period_end,
    leads_received, leads_attended, opps_generated, opps_won, won_value,
    sla_missed_count, attendance_rate, avg_response_min, conversion_rate,
    snapshot_taken_at
  )
  WITH active_sellers AS (
    SELECT cu.user_id
    FROM   company_users cu
    WHERE  cu.company_id = p_company_id
      AND  cu.is_active  = true
      AND  cu.role IN ('seller', 'manager', 'admin')
  ),
  seller_leads AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT l.id)::INT AS leads_received
    FROM leads l
    WHERE l.company_id  = p_company_id
      AND l.deleted_at  IS NULL
      AND l.created_at >= v_day_start
      AND l.created_at <  v_day_end
    GROUP BY 1
  ),
  seller_opps AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT o.id) FILTER (WHERE o.created_at >= v_day_start AND o.created_at < v_day_end)::INT AS opps_generated,
      COUNT(DISTINCT o.id) FILTER (WHERE o.closed_at  >= v_day_start AND o.closed_at  < v_day_end AND o.status = 'won')::INT  AS opps_won,
      COUNT(DISTINCT o.id) FILTER (WHERE o.closed_at  >= v_day_start AND o.closed_at  < v_day_end AND o.status IN ('won','lost'))::INT AS opps_closed,
      COALESCE(SUM(o.value) FILTER (WHERE o.closed_at >= v_day_start AND o.closed_at < v_day_end AND o.status = 'won'), 0) AS won_value
    FROM leads l
    JOIN opportunities o ON o.lead_id = l.id
    WHERE l.company_id  = p_company_id
      AND l.deleted_at  IS NULL
    GROUP BY 1
  ),
  first_inbound_day AS (
    SELECT DISTINCT ON (cm.conversation_id)
      cm.conversation_id, cm.created_at AS first_in_at
    FROM chat_messages cm
    WHERE cm.company_id = p_company_id
      AND cm.direction  = 'inbound'
      AND cm.created_at >= v_day_start
      AND cm.created_at <  v_day_end
    ORDER BY cm.conversation_id, cm.created_at ASC
  ),
  first_human AS (
    SELECT DISTINCT ON (fi.conversation_id)
      fi.conversation_id,
      EXTRACT(EPOCH FROM (cm.created_at - fi.first_in_at)) / 60.0 AS resp_min
    FROM first_inbound_day fi
    JOIN chat_messages cm
      ON  cm.conversation_id = fi.conversation_id
      AND cm.company_id      = p_company_id
      AND cm.direction       = 'outbound'
      AND cm.is_ai_generated = false
      AND cm.created_at      > fi.first_in_at
    ORDER BY fi.conversation_id, cm.created_at ASC
  ),
  seller_attendance AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT fh.conversation_id)::INT AS leads_attended,
      ROUND(AVG(fh.resp_min)::NUMERIC, 1)    AS avg_response_min
    FROM first_human fh
    JOIN chat_conversations cc ON cc.id = fh.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    WHERE l.company_id = p_company_id AND l.deleted_at IS NULL
    GROUP BY 1
  ),
  seller_sla_missed AS (
    SELECT
      l.responsible_user_id AS user_id,
      COUNT(DISTINCT fi.conversation_id)::INT AS sla_missed_count
    FROM first_inbound_day fi
    JOIN chat_conversations cc ON cc.id = fi.conversation_id
    JOIN leads l               ON l.id  = cc.lead_id
    WHERE l.company_id = p_company_id
      AND l.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM chat_messages cm2
        WHERE cm2.conversation_id = fi.conversation_id
          AND cm2.direction       = 'outbound'
          AND cm2.is_ai_generated = false
          AND cm2.created_at      > fi.first_in_at
      )
    GROUP BY 1
  )
  SELECT
    p_company_id, s.user_id, v_period_start, v_period_end,
    COALESCE(sl.leads_received,    0),
    COALESCE(sa.leads_attended,    0),
    COALESCE(so.opps_generated,    0),
    COALESCE(so.opps_won,          0),
    COALESCE(so.won_value,         0),
    COALESCE(sm.sla_missed_count,  0),
    ROUND(COALESCE(sa.leads_attended::NUMERIC / NULLIF(sl.leads_received, 0), 0), 3),
    COALESCE(sa.avg_response_min,  0),
    ROUND(COALESCE(so.opps_won::NUMERIC / NULLIF(so.opps_closed, 0), 0), 3),
    now()
  FROM  active_sellers s
  LEFT JOIN seller_leads      sl ON sl.user_id = s.user_id
  LEFT JOIN seller_opps       so ON so.user_id = s.user_id
  LEFT JOIN seller_attendance sa ON sa.user_id = s.user_id
  LEFT JOIN seller_sla_missed sm ON sm.user_id = s.user_id
  WHERE COALESCE(sl.leads_received, 0) > 0
  ON CONFLICT ON CONSTRAINT uq_seller_snapshots
  DO UPDATE SET
    leads_received   = EXCLUDED.leads_received,
    leads_attended   = EXCLUDED.leads_attended,
    opps_generated   = EXCLUDED.opps_generated,
    opps_won         = EXCLUDED.opps_won,
    won_value        = EXCLUDED.won_value,
    sla_missed_count = EXCLUDED.sla_missed_count,
    attendance_rate  = EXCLUDED.attendance_rate,
    avg_response_min = EXCLUDED.avg_response_min,
    conversion_rate  = EXCLUDED.conversion_rate,
    snapshot_taken_at = now();

  GET DIAGNOSTICS v_upserted_sellers = ROW_COUNT;

  -- ── Resultado ─────────────────────────────────────────────────────────
  v_result := json_build_object(
    'ok',               true,
    'company_id',       p_company_id,
    'date',             p_date,
    'funnel_id',        v_default_funnel_id,
    'upserted_stages',  v_upserted_stages,
    'upserted_sellers', v_upserted_sellers,
    'leads_created',    v_leads_created,
    'pipeline_total',   v_pipeline_total,
    'won_count',        v_won_count
  );

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object(
    'ok',         false,
    'company_id', p_company_id,
    'date',       p_date,
    'error',      SQLERRM
  );
END;
$$;

-- Sem GRANT para authenticated — chamada apenas via service_role pelo cron
REVOKE EXECUTE ON FUNCTION generate_dashboard_daily_snapshot(UUID, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION generate_dashboard_daily_snapshot(UUID, DATE) FROM authenticated;

COMMENT ON FUNCTION generate_dashboard_daily_snapshot IS
  'Gera o snapshot diário de uma empresa para uma data.
   ANTI-DRIFT: manter sincronizado com get_dashboard_forecast,
   get_dashboard_funnel_executive, get_dashboard_sla_alerts.
   Ao alterar uma RPC de realtime, revisar esta função.
   Incrementar snapshot_version quando a fórmula mudar.
   Chamado pelo cron para D-1, D-2 e D-3 (late arriving data).';
