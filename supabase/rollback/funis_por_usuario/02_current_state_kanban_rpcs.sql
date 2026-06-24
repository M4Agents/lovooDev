-- =====================================================================
-- ESTADO ATUAL: RPCs do Kanban ANTES das migrations
--
-- Fontes:
--   get_stage_positions_paged        → 20260611170000_restrict_leads_in_funnel_rpcs.sql
--   get_funnel_stage_counts          → 20260611170000_restrict_leads_in_funnel_rpcs.sql
--   get_funnel_positions_with_photos → 20260611170000_restrict_leads_in_funnel_rpcs.sql
--   close_opportunity                → 20260623240000_update_close_opportunity_sale_type_validation.sql
--   move_opportunity                 → 20260410120000_move_opportunity_sync_status.sql
--
-- ⚠️  ATENÇÃO: M6a alterou mais do que apenas o guard nestas funções.
--     Diferenças críticas identificadas entre M6a e o estado atual:
--
--     close_opportunity (M6a vs 20260623240000):
--       - M6a usa INSERT INTO lead_stage_history
--       - Original usa INSERT INTO opportunity_stage_history E opportunity_status_history
--       - M6a perdeu INSERT INTO opportunity_status_history (tabela de auditoria)
--       - M6a simplificou variáveis e mensagens de erro
--
--     move_opportunity (M6a vs 20260410120000):
--       - Original insere em opportunity_stage_history ANTES de atualizar a posição
--       - M6a insere em lead_stage_history (tabela diferente)
--       - Original valida stage_type IS NULL com RAISE EXCEPTION
--       - Original inclui lógica 'active' que zera closed_at e loss_reason
--
--     get_stage_positions_paged (M6a vs 20260611170000):
--       - Original inclui tags aggregation (jsonb_agg), chat_contacts JOIN, LATERAL conv JOIN
--       - M6a remove essas joins e usa photo_url de l.stable_photo_url
--       - M6a adiciona value_mode, computed_value, responsible_user_id na estrutura
--
-- Este arquivo representa o estado EXATO que deve ser restaurado via rollback.
-- =====================================================================

-- ══════════════════════════════════════════════════════════════════════
-- 1. get_stage_positions_paged
--    Estado atual (20260611170000)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_stage_positions_paged(
  p_funnel_id   UUID,
  p_stage_id    UUID,
  p_company_id  UUID,
  p_search      TEXT        DEFAULT NULL,
  p_origin      TEXT        DEFAULT NULL,
  p_period_days INT         DEFAULT NULL,
  p_limit       INT         DEFAULT 20,
  p_offset      INT         DEFAULT 0,
  p_tag_ids     UUID[]      DEFAULT NULL,
  p_tag_mode    TEXT        DEFAULT 'or',
  p_start_date  TIMESTAMPTZ DEFAULT NULL,
  p_end_date    TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  -- Calcular restrição uma única vez para toda a query.
  -- auth.uid() sempre presente neste contexto (frontend JWT).
  v_restricted := auth_user_restricted_to_own_leads(p_company_id);

  SELECT COALESCE(
    jsonb_agg(
      row_data
      ORDER BY
        (row_data->>'position_in_stage')::int        ASC,
        (row_data->>'entered_stage_at')::timestamptz DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id',                ofp.id,
      'opportunity_id',    ofp.opportunity_id,
      'lead_id',           ofp.lead_id,
      'funnel_id',         ofp.funnel_id,
      'stage_id',          ofp.stage_id,
      'position_in_stage', ofp.position_in_stage,
      'entered_stage_at',  ofp.entered_stage_at,
      'updated_at',        ofp.updated_at,
      'opportunity', jsonb_build_object(
        'id',                  o.id,
        'lead_id',             o.lead_id,
        'company_id',          o.company_id,
        'title',               o.title,
        'description',         o.description,
        'value',               o.value,
        'currency',            o.currency,
        'status',              o.status,
        'probability',         o.probability,
        'expected_close_date', o.expected_close_date,
        'actual_close_date',   o.actual_close_date,
        'source',              o.source,
        'owner_user_id',       o.owner_user_id,
        'created_at',          o.created_at,
        'updated_at',          o.updated_at,
        'closed_at',           o.closed_at,
        'lead', jsonb_build_object(
          'id',                  l.id,
          'name',                l.name,
          'email',               l.email,
          'phone',               l.phone,
          'company_name',        l.company_name,
          'created_at',          l.created_at,
          'origin',              l.origin,
          'status',              l.status,
          'record_type',         l.record_type,
          'last_contact_at',     l.last_contact_at,
          'profile_picture_url', cc.profile_picture_url,
          'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb),
          'tags', COALESCE(
            (SELECT jsonb_agg(lt2.name ORDER BY lt2.name)
             FROM   lead_tag_assignments lta2
             JOIN   lead_tags lt2 ON lt2.id = lta2.tag_id
             WHERE  lta2.lead_id   = l.id
               AND  lt2.is_active  = true),
            '[]'::jsonb
          )
        )
      )
    ) AS row_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities  o  ON o.id  = ofp.opportunity_id
    JOIN  leads          l  ON l.id  = o.lead_id
    LEFT JOIN chat_contacts cc ON
      l.phone_normalized = cc.phone_number
      AND l.company_id   = cc.company_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
      FROM   chat_conversations cv
      WHERE  cv.contact_phone = l.phone_normalized
        AND  cv.company_id    = l.company_id
      ORDER  BY cv.last_message_at DESC NULLS LAST
      LIMIT  1
    ) conv ON true
    WHERE ofp.funnel_id  = p_funnel_id
      AND ofp.stage_id   = p_stage_id
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (
        p_search IS NULL
        OR l.name         ILIKE '%' || p_search || '%'
        OR l.phone        ILIKE '%' || p_search || '%'
        OR l.email        ILIKE '%' || p_search || '%'
        OR l.company_name ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (
        CASE
          WHEN p_start_date IS NOT NULL THEN o.created_at >= p_start_date
          WHEN p_period_days IS NOT NULL THEN o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL
          ELSE TRUE
        END
      )
      AND (p_end_date IS NULL OR o.created_at <= p_end_date)
      AND (
        p_tag_ids IS NULL
        OR cardinality(p_tag_ids) = 0
        OR (
          p_tag_mode = 'or'
          AND EXISTS (
            SELECT 1
            FROM lead_tag_assignments lta
            JOIN lead_tags lt ON lt.id = lta.tag_id
            WHERE lta.lead_id    = l.id
              AND lt.company_id  = p_company_id
              AND lt.is_active   = true
              AND lta.tag_id     = ANY(p_tag_ids)
          )
        )
        OR (
          p_tag_mode = 'and'
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(p_tag_ids) AS tid(v)
            WHERE NOT EXISTS (
              SELECT 1
              FROM lead_tag_assignments lta
              JOIN lead_tags lt ON lt.id = lta.tag_id
              WHERE lta.lead_id   = l.id
                AND lta.tag_id    = tid.v
                AND lt.company_id = p_company_id
                AND lt.is_active  = true
            )
          )
        )
      )
    ORDER BY ofp.position_in_stage ASC, ofp.entered_stage_at DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  ) subq;

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════
-- 2. get_funnel_stage_counts
--    Estado atual (20260611170000)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_funnel_stage_counts(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_search      TEXT        DEFAULT NULL,
  p_origin      TEXT        DEFAULT NULL,
  p_period_days INT         DEFAULT NULL,
  p_tag_ids     UUID[]      DEFAULT NULL,
  p_tag_mode    TEXT        DEFAULT 'or',
  p_start_date  TIMESTAMPTZ DEFAULT NULL,
  p_end_date    TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  IF auth.uid() IS NULL THEN
    v_restricted := false;
  ELSE
    v_restricted := auth_user_restricted_to_own_leads(p_company_id);
  END IF;

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
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (
        p_search IS NULL
        OR l.name         ILIKE '%' || p_search || '%'
        OR l.phone        ILIKE '%' || p_search || '%'
        OR l.email        ILIKE '%' || p_search || '%'
        OR l.company_name ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (
        CASE
          WHEN p_start_date IS NOT NULL THEN o.created_at >= p_start_date
          WHEN p_period_days IS NOT NULL THEN o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL
          ELSE TRUE
        END
      )
      AND (p_end_date IS NULL OR o.created_at <= p_end_date)
      AND (
        p_tag_ids IS NULL
        OR cardinality(p_tag_ids) = 0
        OR (
          p_tag_mode = 'or'
          AND EXISTS (
            SELECT 1
            FROM lead_tag_assignments lta
            JOIN lead_tags lt ON lt.id = lta.tag_id
            WHERE lta.lead_id    = l.id
              AND lt.company_id  = p_company_id
              AND lt.is_active   = true
              AND lta.tag_id     = ANY(p_tag_ids)
          )
        )
        OR (
          p_tag_mode = 'and'
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(p_tag_ids) AS tid(v)
            WHERE NOT EXISTS (
              SELECT 1
              FROM lead_tag_assignments lta
              JOIN lead_tags lt ON lt.id = lta.tag_id
              WHERE lta.lead_id   = l.id
                AND lta.tag_id    = tid.v
                AND lt.company_id = p_company_id
                AND lt.is_active  = true
            )
          )
        )
      )
    GROUP BY ofp.stage_id
  ) subq;

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════
-- 3. get_funnel_positions_with_photos
--    Estado atual (20260611170000)
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_funnel_positions_with_photos(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_stage_id    UUID    DEFAULT NULL,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  v_restricted := auth_user_restricted_to_own_leads(p_company_id);

  SELECT COALESCE(
    jsonb_agg(row_data ORDER BY (row_data->>'position_in_stage')::int ASC),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id',                ofp.id,
      'opportunity_id',    ofp.opportunity_id,
      'lead_id',           ofp.lead_id,
      'funnel_id',         ofp.funnel_id,
      'stage_id',          ofp.stage_id,
      'position_in_stage', ofp.position_in_stage,
      'entered_stage_at',  ofp.entered_stage_at,
      'updated_at',        ofp.updated_at,
      'reentry_count',     COALESCE(rc.reentry_count, 0),
      'opportunity', jsonb_build_object(
        'id',                  o.id,
        'lead_id',             o.lead_id,
        'company_id',          o.company_id,
        'title',               o.title,
        'description',         o.description,
        'value',               o.value,
        'currency',            o.currency,
        'status',              o.status,
        'probability',         o.probability,
        'expected_close_date', o.expected_close_date,
        'actual_close_date',   o.actual_close_date,
        'source',              o.source,
        'owner_user_id',       o.owner_user_id,
        'created_at',          o.created_at,
        'updated_at',          o.updated_at,
        'closed_at',           o.closed_at,
        'value_mode',          o.value_mode,
        'items_subtotal',      o.items_subtotal,
        'discount_type',       o.discount_type,
        'discount_value',      o.discount_value,
        'lead', jsonb_build_object(
          'id',                  l.id,
          'name',                l.name,
          'is_over_plan',        l.is_over_plan,
          'email',               CASE WHEN l.is_over_plan THEN NULL ELSE l.email END,
          'phone',               CASE WHEN l.is_over_plan THEN NULL ELSE l.phone END,
          'company_name',        l.company_name,
          'created_at',          l.created_at,
          'origin',              l.origin,
          'status',              l.status,
          'record_type',         l.record_type,
          'last_contact_at',     l.last_contact_at,
          'profile_picture_url', cc.profile_picture_url,
          'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb)
        )
      )
    ) AS row_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities  o  ON o.id  = ofp.opportunity_id
    JOIN  leads          l  ON l.id  = o.lead_id
    LEFT JOIN chat_contacts cc ON
      l.phone_normalized = cc.phone_number
      AND l.company_id   = cc.company_id
    LEFT JOIN (
      SELECT opportunity_id, COUNT(*) AS reentry_count
      FROM opportunity_stage_history
      WHERE move_type  = 'lead_reentry'
        AND company_id = p_company_id
      GROUP BY opportunity_id
    ) rc ON rc.opportunity_id = ofp.opportunity_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
      FROM   chat_conversations cv
      WHERE  cv.contact_phone = l.phone_normalized
        AND  cv.company_id    = l.company_id
      ORDER  BY cv.last_message_at DESC NULLS LAST
      LIMIT  1
    ) conv ON true
    WHERE ofp.funnel_id  = p_funnel_id
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (p_stage_id    IS NULL OR ofp.stage_id = p_stage_id)
      AND (
        p_search IS NULL
        OR l.name  ILIKE '%' || p_search || '%'
        OR l.phone ILIKE '%' || p_search || '%'
        OR l.email ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
  ) subq;

  RETURN v_result;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════
-- 4. close_opportunity
--    Estado atual (20260623240000)
--    ⚠️ M6a alterou esta função significativamente além do guard:
--       - perdeu INSERT INTO opportunity_status_history
--       - perdeu INSERT INTO opportunity_stage_history (usa lead_stage_history)
--       - simplificou variáveis e mensagens de erro
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION close_opportunity(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_to_stage_id       UUID,
  p_position_in_stage INTEGER,
  p_to_status         VARCHAR,
  p_value             DECIMAL,
  p_loss_reason       TEXT,
  p_closed_at         TIMESTAMPTZ,
  p_company_id        UUID
)
RETURNS SETOF opportunities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status     VARCHAR(50);
  v_current_value      DECIMAL(15,2);
  v_currency           VARCHAR(3);
  v_entered_at         TIMESTAMPTZ;
  v_current_stage      UUID;
  v_changed_by         UUID;
  v_require_items      BOOLEAN;
  v_require_sale_type  BOOLEAN;
  v_item_count         INTEGER;
  v_sale_type_count    INTEGER;
BEGIN
  v_changed_by := auth.uid();

  IF p_to_status NOT IN ('won', 'lost') THEN
    RAISE EXCEPTION 'status inválido para fechamento: %', p_to_status;
  END IF;

  SELECT status, value, currency
    INTO v_current_status, v_current_value, v_currency
    FROM opportunities
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oportunidade não encontrada ou sem permissão';
  END IF;

  SELECT ofp.stage_id, ofp.entered_stage_at,
         sf.require_won_items, sf.require_won_sale_type
    INTO v_current_stage, v_entered_at,
         v_require_items, v_require_sale_type
    FROM opportunity_funnel_positions ofp
    JOIN sales_funnels sf
      ON sf.id         = ofp.funnel_id
     AND sf.company_id = p_company_id
   WHERE ofp.opportunity_id = p_opportunity_id
     AND ofp.funnel_id      = p_funnel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_FUNNEL_POSITION'
      USING HINT = 'O funil informado não corresponde à posição atual desta oportunidade.';
  END IF;

  IF p_to_status = 'won' AND v_require_items = true THEN
    SELECT COUNT(*)
      INTO v_item_count
      FROM opportunity_items
     WHERE opportunity_id = p_opportunity_id
       AND company_id     = p_company_id;

    IF v_item_count = 0 THEN
      RAISE EXCEPTION 'WON_ITEM_REQUIRED'
        USING HINT = 'É necessário selecionar ao menos um produto ou serviço para fechar como ganho.';
    END IF;
  END IF;

  IF p_to_status = 'won' AND v_require_sale_type = true THEN
    SELECT COUNT(*)
      INTO v_sale_type_count
      FROM opportunity_sale_types
     WHERE opportunity_id = p_opportunity_id
       AND company_id     = p_company_id;

    IF v_sale_type_count = 0 THEN
      RAISE EXCEPTION 'WON_SALE_TYPE_REQUIRED'
        USING HINT = 'Selecione ao menos um tipo de venda para fechar como ganho.';
    END IF;
  END IF;

  IF v_current_stage IS NOT NULL THEN
    INSERT INTO opportunity_stage_history (
      company_id, opportunity_id, funnel_id,
      from_stage_id, to_stage_id,
      stage_entered_at, stage_left_at,
      moved_by, move_type
    ) VALUES (
      p_company_id, p_opportunity_id, p_funnel_id,
      v_current_stage, p_to_stage_id,
      COALESCE(v_entered_at, now()), now(),
      v_changed_by, p_to_status
    );
  END IF;

  UPDATE opportunity_funnel_positions
     SET stage_id          = p_to_stage_id,
         position_in_stage = p_position_in_stage,
         entered_stage_at  = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  INSERT INTO opportunity_status_history (
    opportunity_id, company_id,
    from_status, to_status,
    value_snapshot, currency_code,
    loss_reason, closed_at,
    changed_at, changed_by
  ) VALUES (
    p_opportunity_id, p_company_id,
    v_current_status, p_to_status,
    COALESCE(p_value, v_current_value),
    COALESCE(v_currency, 'BRL'),
    CASE WHEN p_to_status = 'lost' THEN p_loss_reason ELSE NULL END,
    p_closed_at, now(), v_changed_by
  );

  UPDATE opportunities
     SET status            = p_to_status,
         closed_at         = p_closed_at,
         actual_close_date = p_closed_at::DATE,
         value             = COALESCE(p_value, value),
         loss_reason       = CASE WHEN p_to_status = 'lost' THEN p_loss_reason ELSE NULL END,
         updated_at        = now()
   WHERE id         = p_opportunity_id
     AND company_id = p_company_id;

  RETURN QUERY
    SELECT * FROM opportunities
     WHERE id         = p_opportunity_id
       AND company_id = p_company_id;
END;
$$;


-- ══════════════════════════════════════════════════════════════════════
-- 5. move_opportunity
--    Estado atual (20260410120000)
--    ⚠️ M6a alterou esta função significativamente:
--       - Original usa opportunity_stage_history (M6a usa lead_stage_history)
--       - Original insere no histórico ANTES de atualizar posição
--       - Original valida stage_type IS NULL com RAISE EXCEPTION
--       - Original inclui lógica 'active' que zera closed_at, actual_close_date e loss_reason
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION move_opportunity(
  p_opportunity_id    UUID,
  p_funnel_id         UUID,
  p_from_stage_id     UUID,
  p_to_stage_id       UUID,
  p_position_in_stage INTEGER
)
RETURNS SETOF opportunity_funnel_positions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id          UUID;
  v_actual_from_stage   UUID;
  v_entered_at          TIMESTAMPTZ;
  v_to_stage_type       VARCHAR(50);
BEGIN
  SELECT stage_id, entered_stage_at
    INTO v_actual_from_stage, v_entered_at
    FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'posição não encontrada para opportunity_id=% funnel_id=%',
      p_opportunity_id, p_funnel_id;
  END IF;

  IF v_actual_from_stage = p_to_stage_id THEN
    RETURN QUERY
      SELECT * FROM opportunity_funnel_positions
       WHERE opportunity_id = p_opportunity_id
         AND funnel_id      = p_funnel_id;
    RETURN;
  END IF;

  SELECT company_id
    INTO v_company_id
    FROM opportunities
   WHERE id = p_opportunity_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'oportunidade não encontrada: %', p_opportunity_id;
  END IF;

  INSERT INTO opportunity_stage_history (
    company_id,
    opportunity_id,
    funnel_id,
    from_stage_id,
    to_stage_id,
    stage_entered_at,
    stage_left_at,
    moved_by,
    move_type
  ) VALUES (
    v_company_id,
    p_opportunity_id,
    p_funnel_id,
    v_actual_from_stage,
    p_to_stage_id,
    COALESCE(v_entered_at, now()),
    now(),
    auth.uid(),
    'stage_change'
  );

  UPDATE opportunity_funnel_positions
     SET stage_id          = p_to_stage_id,
         position_in_stage = p_position_in_stage,
         entered_stage_at  = now()
   WHERE opportunity_id = p_opportunity_id
     AND funnel_id      = p_funnel_id;

  SELECT stage_type
    INTO v_to_stage_type
    FROM funnel_stages
   WHERE id = p_to_stage_id
     AND funnel_id = p_funnel_id;

  IF v_to_stage_type IS NULL THEN
    RAISE EXCEPTION 'etapa de destino inválida ou funil incompatível: stage_id=% funnel_id=%',
      p_to_stage_id, p_funnel_id;
  END IF;

  IF v_to_stage_type = 'won' THEN
    UPDATE opportunities
       SET status            = 'won',
           closed_at         = COALESCE(closed_at, now()),
           actual_close_date = COALESCE(actual_close_date, (now())::date),
           updated_at        = now()
     WHERE id = p_opportunity_id
       AND company_id = v_company_id;
  ELSIF v_to_stage_type = 'lost' THEN
    UPDATE opportunities
       SET status            = 'lost',
           closed_at         = COALESCE(closed_at, now()),
           actual_close_date = COALESCE(actual_close_date, (now())::date),
           updated_at        = now()
     WHERE id = p_opportunity_id
       AND company_id = v_company_id;
  ELSIF v_to_stage_type = 'active' THEN
    UPDATE opportunities
       SET status            = 'open',
           closed_at         = NULL,
           actual_close_date = NULL,
           loss_reason       = NULL,
           updated_at        = now()
     WHERE id = p_opportunity_id
       AND company_id = v_company_id;
  END IF;

  RETURN QUERY
    SELECT * FROM opportunity_funnel_positions
     WHERE opportunity_id = p_opportunity_id
       AND funnel_id      = p_funnel_id;
END;
$$;
