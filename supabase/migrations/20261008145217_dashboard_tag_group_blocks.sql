-- Grupos de tags: OU dentro do bloco e E entre os blocos.
-- Substitui somente o corpo de get_dashboard_tag_group_metrics.
-- A assinatura, a coluna e a constraint permanecem.
-- Não cria índice.
--
-- Contrato lido pela função:
--   {"version": 2, "revision": N, "groups": [{"id","name","blocks":[{"id","tag_ids":[...]}]}]}
-- blocks é a única regra. tag_ids na raiz do grupo não é interpretado.
-- {"groups":[]} continua vazio.
-- Formato ausente, versão diferente ou bloco malformado deixa o grupo inválido,
-- com métricas nulas. Não há leitura alternativa.
--
-- O lead entra no grupo quando possui pelo menos uma tag de cada bloco.
-- Várias tags do mesmo bloco contam uma vez.
-- Oportunidades continuam agregadas por lead, da mesma empresa,
-- sem filtro pela data da venda.
--
-- Esta migration precisa estar aplicada antes do salvamento do formato novo
-- em um ambiente que consulta as métricas.
--
-- save_dashboard_tag_group_settings grava numa única sentença.
-- Duas chamadas com a mesma revisão: uma vence e a outra volta conflito.
-- O UPDATE altera só tag_group_settings e updated_by.
--
-- Rollback: não restaurar o corpo anterior depois que existirem grupos
-- com blocks. Desative a interface ou publique um frontend compatível
-- com o schema 2. A função, a coluna e os grupos salvos permanecem.

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
  v_version_ok boolean;
  v_within_limit boolean;
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

  v_version_ok := (v_settings -> 'version') = '2'::jsonb;
  v_within_limit := jsonb_array_length(v_groups) <= 8;

  WITH raw_groups AS (
    SELECT
      item.ordinality::int AS position,
      item.grp ->> 'id' AS group_id,
      item.grp ->> 'name' AS group_name,
      CASE
        WHEN jsonb_typeof(item.grp) = 'object' AND jsonb_typeof(item.grp -> 'blocks') = 'array'
          THEN item.grp -> 'blocks'
        ELSE NULL
      END AS blocks
    FROM jsonb_array_elements(v_groups) WITH ORDINALITY AS item(grp, ordinality)
  ),
  block_stats AS (
    SELECT
      rg.position,
      COUNT(blk.block)::int AS block_count,
      bool_and(
        jsonb_typeof(blk.block) = 'object'
        AND COALESCE(blk.block ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND jsonb_typeof(blk.block -> 'tag_ids') = 'array'
        AND jsonb_array_length(blk.block -> 'tag_ids') BETWEEN 1 AND 10
        AND CASE
          WHEN jsonb_typeof(blk.block -> 'tag_ids') IS DISTINCT FROM 'array' THEN false
          ELSE NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(blk.block -> 'tag_ids') AS elem
            WHERE jsonb_typeof(elem) IS DISTINCT FROM 'string'
          )
        END
      ) AS blocks_well_formed,
      (COUNT(DISTINCT NULLIF(blk.block ->> 'id', '')) = COUNT(blk.block)) AS block_ids_unique
    FROM raw_groups rg
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(rg.blocks) = 'array' THEN rg.blocks ELSE '[]'::jsonb END
    ) AS blk(block) ON TRUE
    GROUP BY rg.position
  ),
  tag_rows AS (
    SELECT
      rg.position,
      tag.tag_id,
      (
        tag.tag_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND lt.id IS NOT NULL
        AND lt.company_id = p_company_id
        AND lt.is_active IS TRUE
      ) AS tag_ok
    FROM raw_groups rg
    JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(rg.blocks) = 'array' THEN rg.blocks ELSE '[]'::jsonb END
    ) AS blk(block) ON TRUE
    JOIN LATERAL (
      SELECT elem #>> '{}' AS tag_id
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(blk.block) = 'object'
           AND jsonb_typeof(blk.block -> 'tag_ids') = 'array'
            THEN blk.block -> 'tag_ids'
          ELSE '[]'::jsonb
        END
      ) AS elem
      WHERE jsonb_typeof(elem) = 'string'
    ) AS tag ON TRUE
    LEFT JOIN public.lead_tags lt
      ON lt.company_id = p_company_id
     AND lt.id::text = tag.tag_id
  ),
  dup_tags AS (
    SELECT rg.position
    FROM raw_groups rg
    JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(rg.blocks) = 'array' THEN rg.blocks ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS blk(block, block_pos) ON TRUE
    JOIN LATERAL (
      SELECT elem #>> '{}' AS tag_id
      FROM jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(blk.block) = 'object'
           AND jsonb_typeof(blk.block -> 'tag_ids') = 'array'
            THEN blk.block -> 'tag_ids'
          ELSE '[]'::jsonb
        END
      ) AS elem
      WHERE jsonb_typeof(elem) = 'string'
    ) AS tag ON TRUE
    GROUP BY rg.position, blk.block_pos, tag.tag_id
    HAVING COUNT(*) > 1
  ),
  classified AS (
    SELECT
      rg.position,
      rg.group_id,
      rg.group_name,
      CASE WHEN jsonb_typeof(rg.blocks) = 'array' THEN rg.blocks ELSE '[]'::jsonb END AS blocks,
      COALESCE(bs.block_count, 0) AS block_count,
      (
        v_version_ok
        AND v_within_limit
        AND jsonb_typeof(rg.blocks) = 'array'
        AND COALESCE(bs.block_count, 0) BETWEEN 1 AND 4
        AND COALESCE(bs.blocks_well_formed, false)
        AND COALESCE(bs.block_ids_unique, false)
        AND NOT EXISTS (SELECT 1 FROM dup_tags d WHERE d.position = rg.position)
        AND COALESCE((
          SELECT bool_and(tr.tag_ok)
          FROM tag_rows tr
          WHERE tr.position = rg.position
        ), false)
      ) AS is_valid,
      COALESCE((
        SELECT array_agg(DISTINCT tr.tag_id)
        FROM tag_rows tr
        WHERE tr.position = rg.position
          AND NOT tr.tag_ok
      ), ARRAY[]::text[]) AS invalid_tag_ids
    FROM raw_groups rg
    LEFT JOIN block_stats bs ON bs.position = rg.position
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'position', position,
      'group_id', group_id,
      'name', group_name,
      'status', CASE WHEN is_valid THEN 'ok' ELSE 'invalid' END,
      'invalid_tag_ids', to_jsonb(invalid_tag_ids),
      'blocks', CASE WHEN is_valid THEN blocks ELSE '[]'::jsonb END,
      'block_count', CASE WHEN is_valid THEN block_count ELSE 0 END
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

  SELECT COALESCE(array_agg(DISTINCT tag.tid::uuid), ARRAY[]::uuid[])
    INTO v_tag_ids
  FROM jsonb_array_elements(v_classified) g
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(g -> 'blocks') = 'array' THEN g -> 'blocks' ELSE '[]'::jsonb END
  ) AS blk(block)
  CROSS JOIN LATERAL (
    SELECT elem #>> '{}' AS tid
    FROM jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(blk.block -> 'tag_ids') = 'array' THEN blk.block -> 'tag_ids'
        ELSE '[]'::jsonb
      END
    ) AS elem
    WHERE jsonb_typeof(elem) = 'string'
  ) AS tag
  WHERE g ->> 'status' = 'ok'
    AND tag.tid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  WITH valid_groups AS (
    SELECT
      (g ->> 'position')::int AS position,
      g ->> 'group_id' AS group_id,
      g ->> 'name' AS group_name,
      g -> 'blocks' AS blocks,
      (g ->> 'block_count')::int AS block_count
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
    JOIN LATERAL jsonb_array_elements(vg.blocks) WITH ORDINALITY AS blk(block, block_pos) ON TRUE
    JOIN assigned a
      ON a.tag_id = ANY (
        ARRAY(
          SELECT elem #>> '{}'
          FROM jsonb_array_elements(blk.block -> 'tag_ids') AS elem
          WHERE jsonb_typeof(elem) = 'string'
        )::uuid[]
      )
    GROUP BY vg.group_id, a.lead_id, vg.block_count
    HAVING COUNT(DISTINCT blk.block_pos) = vg.block_count
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
  'O lead entra no grupo quando tem pelo menos uma tag de cada bloco. Oportunidades da mesma empresa, sem filtro pela data da venda.';

-- Revisão inicial 0: linha ausente ou tag_group_settings exatamente {"groups":[]}.
-- A revisão persistida é sempre a esperada mais um, gravada nesta função.
-- O JSON recebido não escolhe esse número.

CREATE OR REPLACE FUNCTION public.save_dashboard_tag_group_settings(
  p_company_id uuid,
  p_settings jsonb,
  p_expected_revision integer,
  p_updated_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next jsonb;
  v_settings jsonb;
  v_updated_at timestamptz;
BEGIN
  IF p_company_id IS NULL
     OR p_expected_revision IS NULL
     OR p_expected_revision < 0
     OR p_expected_revision >= 2147483647
     OR jsonb_typeof(p_settings) IS DISTINCT FROM 'object'
     OR (p_settings -> 'version') IS DISTINCT FROM '2'::jsonb
     OR jsonb_typeof(p_settings -> 'groups') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_settings -> 'groups') > 8
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(p_settings -> 'groups') AS item(grp)
       WHERE jsonb_typeof(item.grp) IS DISTINCT FROM 'object'
          OR item.grp ? 'tag_ids'
          OR (item.grp ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          OR length(btrim(COALESCE(item.grp ->> 'name', ''))) NOT BETWEEN 1 AND 40
          OR jsonb_typeof(item.grp -> 'blocks') IS DISTINCT FROM 'array'
          OR jsonb_array_length(item.grp -> 'blocks') NOT BETWEEN 1 AND 4
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(item.grp -> 'blocks') AS blk(block)
            WHERE jsonb_typeof(blk.block) IS DISTINCT FROM 'object'
               OR (blk.block ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               OR jsonb_typeof(blk.block -> 'tag_ids') IS DISTINCT FROM 'array'
               OR jsonb_array_length(blk.block -> 'tag_ids') NOT BETWEEN 1 AND 10
               OR EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements(blk.block -> 'tag_ids') AS elem
                 WHERE jsonb_typeof(elem) IS DISTINCT FROM 'string'
                    OR (elem #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               )
               OR (
                 SELECT COUNT(*)
                 FROM jsonb_array_elements(
                   CASE
                     WHEN jsonb_typeof(blk.block -> 'tag_ids') = 'array' THEN blk.block -> 'tag_ids'
                     ELSE '[]'::jsonb
                   END
                 ) AS elem
                 WHERE jsonb_typeof(elem) = 'string'
               ) IS DISTINCT FROM (
                 SELECT COUNT(DISTINCT elem #>> '{}')
                 FROM jsonb_array_elements(
                   CASE
                     WHEN jsonb_typeof(blk.block -> 'tag_ids') = 'array' THEN blk.block -> 'tag_ids'
                     ELSE '[]'::jsonb
                   END
                 ) AS elem
                 WHERE jsonb_typeof(elem) = 'string'
               )
          )
     ) THEN
    RAISE EXCEPTION 'configuracao invalida' USING ERRCODE = '22023';
  END IF;

  v_next := jsonb_set(
    p_settings,
    '{revision}',
    to_jsonb(p_expected_revision + 1),
    true
  );

  UPDATE public.dashboard_alert_settings
  SET
    tag_group_settings = v_next,
    updated_by = p_updated_by
  WHERE company_id = p_company_id
    AND (
      (
        p_expected_revision = 0
        AND tag_group_settings = '{"groups":[]}'::jsonb
      )
      OR (
        jsonb_typeof(tag_group_settings -> 'revision') = 'number'
        AND (tag_group_settings ->> 'revision') ~ '^[0-9]+$'
        AND (tag_group_settings ->> 'revision')::bigint = p_expected_revision::bigint
      )
    )
  RETURNING tag_group_settings, updated_at
  INTO v_settings, v_updated_at;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'conflict', false,
      'tag_group_settings', v_settings,
      'updated_at', v_updated_at
    );
  END IF;

  IF p_expected_revision <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'conflict', true);
  END IF;

  BEGIN
    INSERT INTO public.dashboard_alert_settings (company_id, tag_group_settings, updated_by)
    VALUES (p_company_id, v_next, p_updated_by)
    RETURNING tag_group_settings, updated_at
    INTO v_settings, v_updated_at;

    RETURN jsonb_build_object(
      'ok', true,
      'conflict', false,
      'tag_group_settings', v_settings,
      'updated_at', v_updated_at
    );
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'conflict', true);
  END;
END;
$$;

ALTER FUNCTION public.save_dashboard_tag_group_settings(uuid, jsonb, integer, uuid) OWNER TO postgres;
ALTER FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.save_dashboard_tag_group_settings(uuid, jsonb, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_dashboard_tag_group_settings(uuid, jsonb, integer, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.save_dashboard_tag_group_settings(uuid, jsonb, integer, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_dashboard_tag_group_settings(uuid, jsonb, integer, uuid) TO service_role;

COMMENT ON FUNCTION public.save_dashboard_tag_group_settings IS
  'Grava tag_group_settings da empresa recebida se a revisão esperada ainda for a atual. '
  'A revisão persistida é a esperada mais um. Não altera colunas de alerta. '
  'Conflito devolve ok false sem modificar a linha. Outros erros propagam.';
