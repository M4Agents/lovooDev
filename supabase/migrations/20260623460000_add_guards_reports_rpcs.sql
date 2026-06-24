-- =====================================================================
-- M6b: Guards de Reports RPCs
-- Versão CORRIGIDA em 2026-06-24 (após falha de aplicação)
--
-- CAUSA DA FALHA ORIGINAL:
--   get_seller_performance e get_cycle_time_metrics tinham retornos
--   divergentes do estado real do banco:
--     • get_seller_performance: "owner_user_id" → real é "user_id"
--     • get_cycle_time_metrics: "breakdown_type / entity_id / entity_name"
--                               → real é "dimension / group_id / group_name"
--   Além disso, ambas usam LEFT JOIN auth.users (não company_users).
--
-- ESTRATÉGIA DESTA VERSÃO:
--   • Corpos 100% fiéis ao estado real do banco (pg_get_functiondef())
--   • Apenas guards adicionados via v_resolved_ids
--   • get_funnel_overview: LANGUAGE sql mantida, guard via CTE (sem mudar LANGUAGE)
--   • get_stage_time_metrics: CREATE OR REPLACE (retorno compatível)
--   • get_seller_performance: DROP + CREATE obrigatório (retorno compatível,
--     mas DROP + CREATE garante substituição limpa)
--   • get_cycle_time_metrics: DROP + CREATE obrigatório (retorno compatível,
--     mas DROP + CREATE garante substituição limpa)
--
-- MODIFICAÇÕES ÚNICAS POR FUNÇÃO (guards):
--   Todas as funções recebem:
--     v_resolved_ids := resolve_user_funnel_ids_access(p_company_id, p_funnel_ids);
--   E substituem toda ocorrência de:
--     (p_funnel_ids IS NULL OR ... ANY(p_funnel_ids))
--   Por:
--     (v_resolved_ids IS NULL OR ... ANY(v_resolved_ids))
-- =====================================================================


-- ══════════════════════════════════════════════════════════════════════
-- PASSO 1: Helper resolve_user_funnel_ids_access
-- Centraliza a lógica de bypass por role + restrições por user settings
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.resolve_user_funnel_ids_access(
  p_company_id uuid,
  p_funnel_ids uuid[]
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role        TEXT;
  v_uid         UUID;
  v_is_enabled  BOOLEAN;
  v_allowed     UUID[];
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Obter role do usuário nesta empresa
  SELECT cu.role INTO v_role
  FROM company_users cu
  WHERE cu.user_id    = v_uid
    AND cu.company_id = p_company_id
    AND cu.is_active  = TRUE;

  -- Bypass para roles elevadas: admin, super_admin, system_admin
  IF v_role IN ('admin', 'super_admin', 'system_admin') THEN
    RETURN p_funnel_ids;
  END IF;

  -- Bypass para partner com acesso à empresa
  IF v_role = 'partner' THEN
    IF auth_user_is_partner_for_company(p_company_id) THEN
      RETURN p_funnel_ids;
    END IF;
  END IF;

  -- Para manager e seller: verificar se restrição está ativa
  SELECT ufs.is_enabled INTO v_is_enabled
  FROM user_funnel_settings ufs
  WHERE ufs.user_id    = v_uid
    AND ufs.company_id = p_company_id;

  -- Se não tem settings ou não está habilitado: sem restrição
  IF v_is_enabled IS NULL OR v_is_enabled = FALSE THEN
    RETURN p_funnel_ids;
  END IF;

  -- Restrição ativa: interseção entre funis permitidos e funis solicitados
  SELECT ARRAY_AGG(uaf.funnel_id) INTO v_allowed
  FROM user_allowed_funnels uaf
  WHERE uaf.user_id    = v_uid
    AND uaf.company_id = p_company_id;

  IF v_allowed IS NULL OR array_length(v_allowed, 1) = 0 THEN
    RETURN p_funnel_ids;
  END IF;

  IF p_funnel_ids IS NULL THEN
    RETURN v_allowed;
  END IF;

  -- Retorna apenas funis que estão em ambas as listas
  RETURN ARRAY(
    SELECT unnest(p_funnel_ids)
    INTERSECT
    SELECT unnest(v_allowed)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_user_funnel_ids_access(UUID, UUID[]) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- PASSO 2: get_funnel_overview
-- LANGUAGE sql MANTIDA (sem conversão para plpgsql)
-- Guard adicionado via CTE v_resolved:
--   • Chama resolve_user_funnel_ids_access(p_company_id, p_funnel_ids)
--   • Cross-join com v_resolved (1 linha garantida)
--   • Substitui (p_funnel_ids IS NULL OR ...) por (v_resolved.ids IS NULL OR ...)
-- CREATE OR REPLACE: retorno idêntico, LANGUAGE mantida → sem DROP necessário
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_funnel_overview(
  p_company_id   uuid,
  p_funnel_ids   uuid[]      DEFAULT NULL::uuid[],
  p_date_from    timestamptz DEFAULT date_trunc('month'::text, now()),
  p_date_to      timestamptz DEFAULT now(),
  p_stalled_days integer     DEFAULT 15
)
RETURNS TABLE(
  open_count             bigint,
  won_count              bigint,
  lost_count             bigint,
  conversion_rate        numeric,
  won_value              numeric,
  lost_value             numeric,
  avg_cycle_won_seconds  numeric,
  avg_cycle_lost_seconds numeric,
  stalled_count          bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- [GUARD] Resolve funis permitidos para o usuário atual
  WITH v_resolved AS (
    SELECT resolve_user_funnel_ids_access(p_company_id, p_funnel_ids) AS ids
  )
  SELECT
    COUNT(*) FILTER (WHERE o.status = 'open')::BIGINT,
    COUNT(*) FILTER (WHERE o.status = 'won'
      AND o.closed_at BETWEEN p_date_from AND p_date_to)::BIGINT,
    COUNT(*) FILTER (WHERE o.status = 'lost'
      AND o.closed_at BETWEEN p_date_from AND p_date_to)::BIGINT,
    ROUND(
      COUNT(*) FILTER (WHERE o.status = 'won'
        AND o.closed_at BETWEEN p_date_from AND p_date_to)::NUMERIC
      / NULLIF(COUNT(*) FILTER (WHERE o.status IN ('won','lost')
        AND o.closed_at BETWEEN p_date_from AND p_date_to), 0)::NUMERIC * 100
    , 1),
    COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'
      AND o.closed_at BETWEEN p_date_from AND p_date_to), 0),
    COALESCE(SUM(o.value) FILTER (WHERE o.status = 'lost'
      AND o.closed_at BETWEEN p_date_from AND p_date_to), 0),
    ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at))) FILTER (
      WHERE o.status = 'won' AND o.closed_at BETWEEN p_date_from AND p_date_to)),
    ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at))) FILTER (
      WHERE o.status = 'lost' AND o.closed_at BETWEEN p_date_from AND p_date_to)),
    COUNT(*) FILTER (
      WHERE o.status = 'open'
        AND ofp.entered_stage_at < now() - (p_stalled_days || ' days')::INTERVAL
    )::BIGINT
  FROM v_resolved,           -- cross-join: 1 linha, sem produto cartesiano
       opportunities o
  JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
  WHERE o.company_id = p_company_id
    AND (v_resolved.ids IS NULL OR ofp.funnel_id = ANY(v_resolved.ids));
$function$;

GRANT EXECUTE ON FUNCTION get_funnel_overview(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ, INTEGER)
  TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- PASSO 3: get_stage_time_metrics
-- LANGUAGE plpgsql, retorno compatível → CREATE OR REPLACE (sem DROP)
-- Guard adicionado:
--   DECLARE v_resolved_ids UUID[];
--   v_resolved_ids := resolve_user_funnel_ids_access(p_company_id, p_funnel_ids);
-- Substituição: p_funnel_ids → v_resolved_ids em todas as cláusulas WHERE
-- PERCENTILE_CONT preservado com cast duplo ::NUMERIC exato do banco:
--   ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ...::NUMERIC)::NUMERIC)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_stage_time_metrics(
  p_company_id  uuid,
  p_funnel_ids  uuid[]      DEFAULT NULL::uuid[],
  p_date_from   timestamptz DEFAULT date_trunc('month'::text, now()),
  p_date_to     timestamptz DEFAULT now()
)
RETURNS TABLE(
  stage_id                  uuid,
  stage_name                text,
  stage_color               text,
  stage_position            integer,
  funnel_id                 uuid,
  funnel_name               text,
  current_open_count        bigint,
  historical_movement_count bigint,
  avg_duration_seconds      numeric,
  median_duration_seconds   numeric,
  max_duration_seconds      numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resolved_ids UUID[]; -- [GUARD] funis permitidos para o usuário atual
BEGIN
  -- [GUARD] Resolver funis permitidos
  v_resolved_ids := resolve_user_funnel_ids_access(p_company_id, p_funnel_ids);

  RETURN QUERY
  WITH current_open AS (
    SELECT ofp.stage_id AS sid, COUNT(DISTINCT ofp.opportunity_id)::BIGINT AS cnt
    FROM opportunity_funnel_positions ofp
    JOIN opportunities o ON o.id = ofp.opportunity_id
    WHERE o.company_id = p_company_id
      AND o.status = 'open'
      AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    GROUP BY ofp.stage_id
  ),
  stage_hist AS (
    SELECT
      osh.from_stage_id                                                                              AS sid,
      COUNT(*)::BIGINT                                                                               AS mv_count,
      ROUND(AVG(osh.duration_seconds::NUMERIC))                                                     AS avg_dur,
      ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY osh.duration_seconds::NUMERIC)::NUMERIC)   AS med_dur,
      MAX(osh.duration_seconds)::NUMERIC                                                            AS max_dur
    FROM opportunity_stage_history osh
    WHERE osh.company_id    = p_company_id
      AND osh.from_stage_id IS NOT NULL
      AND osh.duration_seconds IS NOT NULL
      AND (v_resolved_ids IS NULL OR osh.funnel_id = ANY(v_resolved_ids))
      AND osh.stage_left_at BETWEEN p_date_from AND p_date_to
    GROUP BY osh.from_stage_id
  )
  SELECT
    fs.id, fs.name::TEXT, fs.color::TEXT, fs.position,
    sf.id, sf.name::TEXT,
    COALESCE(co.cnt, 0), COALESCE(sh.mv_count, 0),
    sh.avg_dur, sh.med_dur, sh.max_dur
  FROM funnel_stages fs
  JOIN sales_funnels sf ON sf.id = fs.funnel_id
  LEFT JOIN current_open co ON co.sid = fs.id
  LEFT JOIN stage_hist    sh ON sh.sid = fs.id
  WHERE sf.company_id = p_company_id
    AND (v_resolved_ids IS NULL OR fs.funnel_id = ANY(v_resolved_ids))
    AND (fs.is_hidden IS NULL OR fs.is_hidden = FALSE)
  ORDER BY sf.name, fs.position;
END;
$function$;

GRANT EXECUTE ON FUNCTION get_stage_time_metrics(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- PASSO 4: get_seller_performance
-- DROP + CREATE OBRIGATÓRIO:
--   Embora os tipos sejam compatíveis, DROP+CREATE garante substituição limpa.
--   Retorna "user_id uuid" — nome real do banco (NÃO owner_user_id)
--   Usa LEFT JOIN auth.users au para nomes de usuários
-- Guard: DECLARE v_resolved_ids + substituição p_funnel_ids → v_resolved_ids
-- ══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_seller_performance(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ);

CREATE FUNCTION public.get_seller_performance(
  p_company_id  uuid,
  p_funnel_ids  uuid[]      DEFAULT NULL::uuid[],
  p_date_from   timestamptz DEFAULT date_trunc('month'::text, now()),
  p_date_to     timestamptz DEFAULT now()
)
RETURNS TABLE(
  user_id           uuid,
  user_name         text,
  open_count        bigint,
  won_count         bigint,
  lost_count        bigint,
  won_value         numeric,
  conversion_rate   numeric,
  avg_cycle_seconds numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resolved_ids UUID[]; -- [GUARD] funis permitidos para o usuário atual
BEGIN
  -- [GUARD] Resolver funis permitidos
  v_resolved_ids := resolve_user_funnel_ids_access(p_company_id, p_funnel_ids);

  RETURN QUERY
  WITH open_by_seller AS (
    SELECT o.owner_user_id AS uid, COUNT(*)::BIGINT AS cnt
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id     = p_company_id
      AND o.status         = 'open'
      AND o.owner_user_id  IS NOT NULL
      AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    GROUP BY o.owner_user_id
  ),
  closed_by_seller AS (
    SELECT
      o.owner_user_id                                                                  AS uid,
      COUNT(*) FILTER (WHERE o.status = 'won')::BIGINT                                AS won_cnt,
      COUNT(*) FILTER (WHERE o.status = 'lost')::BIGINT                               AS lost_cnt,
      COALESCE(SUM(o.value) FILTER (WHERE o.status = 'won'), 0)                       AS w_val,
      ROUND(AVG(EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC)
        FILTER (WHERE o.status = 'won'))                                               AS avg_cycle
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    WHERE o.company_id    = p_company_id
      AND o.closed_at     BETWEEN p_date_from AND p_date_to
      AND o.status        IN ('won', 'lost')
      AND o.owner_user_id IS NOT NULL
      AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    GROUP BY o.owner_user_id
  )
  SELECT
    COALESCE(cs.uid, os.uid),
    COALESCE(
      au.raw_user_meta_data->>'name',
      au.raw_user_meta_data->>'display_name',
      au.raw_user_meta_data->>'full_name',
      split_part(au.email::text, '@', 1),
      'Usuário removido'
    )::TEXT,
    COALESCE(os.cnt, 0),
    COALESCE(cs.won_cnt, 0),
    COALESCE(cs.lost_cnt, 0),
    COALESCE(cs.w_val, 0),
    ROUND(
      COALESCE(cs.won_cnt, 0)::NUMERIC
      / NULLIF(COALESCE(cs.won_cnt, 0) + COALESCE(cs.lost_cnt, 0), 0)::NUMERIC
      * 100, 1
    ),
    cs.avg_cycle
  FROM closed_by_seller cs
  FULL OUTER JOIN open_by_seller os ON os.uid = cs.uid
  LEFT JOIN auth.users au ON au.id = COALESCE(cs.uid, os.uid)
  ORDER BY COALESCE(cs.w_val, 0) DESC NULLS LAST;
END;
$function$;

GRANT EXECUTE ON FUNCTION get_seller_performance(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- PASSO 5: get_cycle_time_metrics
-- DROP + CREATE OBRIGATÓRIO:
--   Retorna "dimension text, group_id uuid, group_name text"
--   (NÃO breakdown_type / entity_id / entity_name)
--   Usa PERCENTILE_CONT(...)::NUMERIC com cast duplo exato do banco
--   Usa LEFT JOIN auth.users au para seller breakdown
-- Guard: DECLARE v_resolved_ids + substituição p_funnel_ids → v_resolved_ids
--   Aplicado nos 3 blocos RETURN QUERY (total, funnel, seller)
-- ══════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_cycle_time_metrics(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ);

CREATE FUNCTION public.get_cycle_time_metrics(
  p_company_id  uuid,
  p_funnel_ids  uuid[]      DEFAULT NULL::uuid[],
  p_date_from   timestamptz DEFAULT date_trunc('month'::text, now()),
  p_date_to     timestamptz DEFAULT now()
)
RETURNS TABLE(
  dimension           text,
  group_id            uuid,
  group_name          text,
  won_count           bigint,
  lost_count          bigint,
  won_avg_seconds     numeric,
  won_median_seconds  numeric,
  won_max_seconds     numeric,
  won_min_seconds     numeric,
  lost_avg_seconds    numeric,
  lost_median_seconds numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_resolved_ids UUID[]; -- [GUARD] funis permitidos para o usuário atual
BEGIN
  -- [GUARD] Resolver funis permitidos (aplicado nos 3 blocos abaixo)
  v_resolved_ids := resolve_user_funnel_ids_access(p_company_id, p_funnel_ids);

  -- Total
  RETURN QUERY WITH
    won_total AS (
      SELECT EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      WHERE o.company_id = p_company_id AND o.status = 'won'
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    ),
    lost_total AS (
      SELECT EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      WHERE o.company_id = p_company_id AND o.status = 'lost'
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    ),
    won_agg AS (
      SELECT COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s,
        ROUND(MAX(secs)) AS max_s,
        ROUND(MIN(secs)) AS min_s
      FROM won_total
    ),
    lost_agg AS (
      SELECT COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s
      FROM lost_total
    )
  SELECT 'total'::TEXT, NULL::UUID, 'Total'::TEXT,
    wa.cnt, la.cnt, wa.avg_s, wa.med_s, wa.max_s, wa.min_s, la.avg_s, la.med_s
  FROM won_agg wa, lost_agg la;

  -- By funnel
  RETURN QUERY WITH
    won_f AS (
      SELECT ofp.funnel_id, sf.name AS fn,
        EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      JOIN sales_funnels sf ON sf.id = ofp.funnel_id
      WHERE o.company_id = p_company_id AND o.status = 'won'
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    ),
    lost_f AS (
      SELECT ofp.funnel_id,
        EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      WHERE o.company_id = p_company_id AND o.status = 'lost'
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    ),
    won_fagg AS (
      SELECT funnel_id, fn, COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s,
        ROUND(MAX(secs)) AS max_s,
        ROUND(MIN(secs)) AS min_s
      FROM won_f GROUP BY funnel_id, fn
    ),
    lost_fagg AS (
      SELECT funnel_id, COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s
      FROM lost_f GROUP BY funnel_id
    )
  SELECT 'funnel'::TEXT, wf.funnel_id, wf.fn::TEXT,
    wf.cnt, COALESCE(lf.cnt, 0), wf.avg_s, wf.med_s, wf.max_s, wf.min_s, lf.avg_s, lf.med_s
  FROM won_fagg wf LEFT JOIN lost_fagg lf ON lf.funnel_id = wf.funnel_id
  ORDER BY wf.cnt DESC;

  -- By seller
  RETURN QUERY WITH
    won_s AS (
      SELECT o.owner_user_id,
        COALESCE(
          au.raw_user_meta_data->>'name',
          au.raw_user_meta_data->>'display_name',
          au.raw_user_meta_data->>'full_name',
          split_part(au.email::text, '@', 1),
          'Usuário removido'
        ) AS uname,
        EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      LEFT JOIN auth.users au ON au.id = o.owner_user_id
      WHERE o.company_id = p_company_id AND o.status = 'won'
        AND o.owner_user_id IS NOT NULL
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    ),
    lost_s AS (
      SELECT o.owner_user_id,
        EXTRACT(EPOCH FROM (o.closed_at - o.created_at))::NUMERIC AS secs
      FROM opportunities o
      JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
      WHERE o.company_id = p_company_id AND o.status = 'lost'
        AND o.owner_user_id IS NOT NULL
        AND o.closed_at BETWEEN p_date_from AND p_date_to
        AND (v_resolved_ids IS NULL OR ofp.funnel_id = ANY(v_resolved_ids))
    ),
    won_sagg AS (
      SELECT owner_user_id, uname, COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s,
        ROUND(MAX(secs)) AS max_s,
        ROUND(MIN(secs)) AS min_s
      FROM won_s GROUP BY owner_user_id, uname
    ),
    lost_sagg AS (
      SELECT owner_user_id, COUNT(*)::BIGINT AS cnt,
        ROUND(AVG(secs)) AS avg_s,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY secs)::NUMERIC) AS med_s
      FROM lost_s GROUP BY owner_user_id
    )
  SELECT 'seller'::TEXT, ws.owner_user_id, ws.uname::TEXT,
    ws.cnt, COALESCE(ls.cnt, 0), ws.avg_s, ws.med_s, ws.max_s, ws.min_s, ls.avg_s, ls.med_s
  FROM won_sagg ws LEFT JOIN lost_sagg ls ON ls.owner_user_id = ws.owner_user_id
  ORDER BY ws.cnt DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION get_cycle_time_metrics(UUID, UUID[], TIMESTAMPTZ, TIMESTAMPTZ)
  TO authenticated;
