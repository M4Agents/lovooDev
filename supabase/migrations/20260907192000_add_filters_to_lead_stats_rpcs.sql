-- =====================================================
-- MIGRATION: Adicionar filtros de status/origin/responsável
--            às RPCs de estatísticas de leads
-- Data: 07/09/2026
--
-- Novos parâmetros opcionais (retrocompatíveis):
--   p_status               TEXT    → filtra leads.status
--   p_origin               TEXT    → filtra leads.origin
--   p_responsible_user_id  TEXT    → UUID do responsável
--                                    ou 'unassigned' para leads sem responsável
-- =====================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. get_lead_dashboard_stats (com novos filtros)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_lead_dashboard_stats(
  p_company_id            UUID,
  p_start_date            TIMESTAMPTZ DEFAULT NULL,
  p_end_date              TIMESTAMPTZ DEFAULT NULL,
  p_tag_ids               UUID[]      DEFAULT NULL,
  p_status                TEXT        DEFAULT NULL,
  p_origin                TEXT        DEFAULT NULL,
  p_responsible_user_id   TEXT        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_leads    BIGINT;
  v_total_entries  BIGINT;
  v_new_leads      BIGINT;
  v_reentry_leads  BIGINT;
BEGIN

  -- ── Filtro de responsável ─────────────────────────────────────────────────
  -- p_responsible_user_id pode ser:
  --   NULL        → sem filtro
  --   'unassigned' → WHERE responsible_user_id IS NULL
  --   <uuid>       → WHERE responsible_user_id = <uuid>::UUID

  -- ── Total de identidades únicas ativas ───────────────────────────────────
  SELECT COUNT(*)
    INTO v_total_leads
    FROM leads l
   WHERE l.company_id = p_company_id
     AND l.deleted_at IS NULL
     AND (p_status IS NULL OR l.status = p_status)
     AND (p_origin IS NULL OR l.origin = p_origin)
     AND (
       p_responsible_user_id IS NULL
       OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
       OR l.responsible_user_id = p_responsible_user_id::UUID
     )
     AND (
       p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
       OR NOT EXISTS (
         SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
         WHERE NOT EXISTS (
           SELECT 1 FROM lead_tag_assignments lta
            WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
         )
       )
     );

  -- ── Entradas no período (com todos os filtros) ───────────────────────────
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN

    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND le.created_at >= p_start_date
       AND le.created_at <= p_end_date
       AND (p_status IS NULL OR l.status = p_status)
       AND (p_origin IS NULL OR l.origin = p_origin)
       AND (
         p_responsible_user_id IS NULL
         OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
         OR l.responsible_user_id = p_responsible_user_id::UUID
       )
       AND (
         p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
         OR NOT EXISTS (
           SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_tag_assignments lta
              WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
           )
         )
       );

    -- Novos: lead cuja primeira entrada ever caiu dentro do período
    SELECT COUNT(*)
      INTO v_new_leads
      FROM (
        SELECT le.lead_id
          FROM lead_entries le
          JOIN leads l ON l.id = le.lead_id
         WHERE le.company_id = p_company_id
           AND l.deleted_at  IS NULL
           AND (p_status IS NULL OR l.status = p_status)
           AND (p_origin IS NULL OR l.origin = p_origin)
           AND (
             p_responsible_user_id IS NULL
             OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
             OR l.responsible_user_id = p_responsible_user_id::UUID
           )
           AND (
             p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
             OR NOT EXISTS (
               SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
               WHERE NOT EXISTS (
                 SELECT 1 FROM lead_tag_assignments lta
                  WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
               )
             )
           )
         GROUP BY le.lead_id
        HAVING MIN(le.created_at) >= p_start_date
           AND MIN(le.created_at) <= p_end_date
      ) sub;

    -- Reentradas: tinham entrada antes do período e voltaram no período
    SELECT COUNT(DISTINCT le.lead_id)
      INTO v_reentry_leads
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND le.created_at >= p_start_date
       AND le.created_at <= p_end_date
       AND (p_status IS NULL OR l.status = p_status)
       AND (p_origin IS NULL OR l.origin = p_origin)
       AND (
         p_responsible_user_id IS NULL
         OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
         OR l.responsible_user_id = p_responsible_user_id::UUID
       )
       AND (
         p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
         OR NOT EXISTS (
           SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_tag_assignments lta
              WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
           )
         )
       )
       AND EXISTS (
         SELECT 1 FROM lead_entries le2
          WHERE le2.company_id = le.company_id
            AND le2.lead_id    = le.lead_id
            AND le2.created_at < p_start_date
       );

  ELSIF p_start_date IS NOT NULL THEN

    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND le.created_at >= p_start_date
       AND (p_status IS NULL OR l.status = p_status)
       AND (p_origin IS NULL OR l.origin = p_origin)
       AND (
         p_responsible_user_id IS NULL
         OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
         OR l.responsible_user_id = p_responsible_user_id::UUID
       )
       AND (
         p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
         OR NOT EXISTS (
           SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_tag_assignments lta
              WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
           )
         )
       );

    SELECT COUNT(*)
      INTO v_new_leads
      FROM (
        SELECT le.lead_id
          FROM lead_entries le
          JOIN leads l ON l.id = le.lead_id
         WHERE le.company_id = p_company_id
           AND l.deleted_at  IS NULL
           AND (p_status IS NULL OR l.status = p_status)
           AND (p_origin IS NULL OR l.origin = p_origin)
           AND (
             p_responsible_user_id IS NULL
             OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
             OR l.responsible_user_id = p_responsible_user_id::UUID
           )
           AND (
             p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
             OR NOT EXISTS (
               SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
               WHERE NOT EXISTS (
                 SELECT 1 FROM lead_tag_assignments lta
                  WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
               )
             )
           )
         GROUP BY le.lead_id
        HAVING MIN(le.created_at) >= p_start_date
      ) sub;

    SELECT COUNT(DISTINCT le.lead_id)
      INTO v_reentry_leads
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND le.created_at >= p_start_date
       AND (p_status IS NULL OR l.status = p_status)
       AND (p_origin IS NULL OR l.origin = p_origin)
       AND (
         p_responsible_user_id IS NULL
         OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
         OR l.responsible_user_id = p_responsible_user_id::UUID
       )
       AND (
         p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
         OR NOT EXISTS (
           SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_tag_assignments lta
              WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
           )
         )
       )
       AND EXISTS (
         SELECT 1 FROM lead_entries le2
          WHERE le2.company_id = le.company_id
            AND le2.lead_id    = le.lead_id
            AND le2.created_at < p_start_date
       );

  ELSE
    -- Sem período: histórico completo
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND (p_status IS NULL OR l.status = p_status)
       AND (p_origin IS NULL OR l.origin = p_origin)
       AND (
         p_responsible_user_id IS NULL
         OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
         OR l.responsible_user_id = p_responsible_user_id::UUID
       )
       AND (
         p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
         OR NOT EXISTS (
           SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
           WHERE NOT EXISTS (
             SELECT 1 FROM lead_tag_assignments lta
              WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
           )
         )
       );

    -- Sem período: new_leads = total de leads (cada um tem sua primeira entrada)
    v_new_leads := v_total_leads;

    -- Sem período: reentry_leads = leads com mais de 1 entrada no histórico
    SELECT COUNT(*)
      INTO v_reentry_leads
      FROM (
        SELECT le.lead_id
          FROM lead_entries le
          JOIN leads l ON l.id = le.lead_id
         WHERE le.company_id = p_company_id
           AND l.deleted_at  IS NULL
           AND (p_status IS NULL OR l.status = p_status)
           AND (p_origin IS NULL OR l.origin = p_origin)
           AND (
             p_responsible_user_id IS NULL
             OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
             OR l.responsible_user_id = p_responsible_user_id::UUID
           )
           AND (
             p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
             OR NOT EXISTS (
               SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
               WHERE NOT EXISTS (
                 SELECT 1 FROM lead_tag_assignments lta
                  WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
               )
             )
           )
         GROUP BY le.lead_id
        HAVING COUNT(*) > 1
      ) sub;
  END IF;

  RETURN jsonb_build_object(
    'total_leads',    v_total_leads,
    'total_entries',  v_total_entries,
    'new_leads',      v_new_leads,
    'reentry_leads',  v_reentry_leads
  );
END;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
-- 2. get_lead_reentries_list (com novos filtros)
-- ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_lead_reentries_list(
  p_company_id            UUID,
  p_start_date            TIMESTAMPTZ DEFAULT NULL,
  p_end_date              TIMESTAMPTZ DEFAULT NULL,
  p_tag_ids               UUID[]      DEFAULT NULL,
  p_limit                 INT         DEFAULT 100,
  p_offset                INT         DEFAULT 0,
  p_status                TEXT        DEFAULT NULL,
  p_origin                TEXT        DEFAULT NULL,
  p_responsible_user_id   TEXT        DEFAULT NULL
)
RETURNS TABLE (
  lead_id        INT,
  lead_name      TEXT,
  lead_phone     TEXT,
  lead_email     TEXT,
  reentry_count  BIGINT,
  last_entry_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN

  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    RETURN QUERY
    SELECT
      l.id::INT,
      l.name::TEXT,
      l.phone::TEXT,
      l.email::TEXT,
      COUNT(le.id)::BIGINT   AS reentry_count,
      MAX(le.created_at)     AS last_entry_at
    FROM lead_entries le
    JOIN leads l ON l.id = le.lead_id
   WHERE le.company_id = p_company_id
     AND l.deleted_at  IS NULL
     AND le.created_at >= p_start_date
     AND le.created_at <= p_end_date
     AND (p_status IS NULL OR l.status = p_status)
     AND (p_origin IS NULL OR l.origin = p_origin)
     AND (
       p_responsible_user_id IS NULL
       OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
       OR l.responsible_user_id = p_responsible_user_id::UUID
     )
     AND EXISTS (
       SELECT 1 FROM lead_entries le2
        WHERE le2.company_id = le.company_id
          AND le2.lead_id    = le.lead_id
          AND le2.created_at < p_start_date
     )
     AND (
       p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
       OR NOT EXISTS (
         SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
         WHERE NOT EXISTS (
           SELECT 1 FROM lead_tag_assignments lta
            WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
         )
       )
     )
   GROUP BY l.id, l.name, l.phone, l.email
   ORDER BY reentry_count DESC, last_entry_at DESC
   LIMIT  p_limit
   OFFSET p_offset;

  ELSIF p_start_date IS NOT NULL THEN
    RETURN QUERY
    SELECT
      l.id::INT,
      l.name::TEXT,
      l.phone::TEXT,
      l.email::TEXT,
      COUNT(le.id)::BIGINT   AS reentry_count,
      MAX(le.created_at)     AS last_entry_at
    FROM lead_entries le
    JOIN leads l ON l.id = le.lead_id
   WHERE le.company_id = p_company_id
     AND l.deleted_at  IS NULL
     AND le.created_at >= p_start_date
     AND (p_status IS NULL OR l.status = p_status)
     AND (p_origin IS NULL OR l.origin = p_origin)
     AND (
       p_responsible_user_id IS NULL
       OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
       OR l.responsible_user_id = p_responsible_user_id::UUID
     )
     AND EXISTS (
       SELECT 1 FROM lead_entries le2
        WHERE le2.company_id = le.company_id
          AND le2.lead_id    = le.lead_id
          AND le2.created_at < p_start_date
     )
     AND (
       p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
       OR NOT EXISTS (
         SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
         WHERE NOT EXISTS (
           SELECT 1 FROM lead_tag_assignments lta
            WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
         )
       )
     )
   GROUP BY l.id, l.name, l.phone, l.email
   ORDER BY reentry_count DESC, last_entry_at DESC
   LIMIT  p_limit
   OFFSET p_offset;

  ELSE
    RETURN QUERY
    SELECT
      l.id::INT,
      l.name::TEXT,
      l.phone::TEXT,
      l.email::TEXT,
      (COUNT(le.id) - 1)::BIGINT  AS reentry_count,
      MAX(le.created_at)          AS last_entry_at
    FROM lead_entries le
    JOIN leads l ON l.id = le.lead_id
   WHERE le.company_id = p_company_id
     AND l.deleted_at  IS NULL
     AND (p_status IS NULL OR l.status = p_status)
     AND (p_origin IS NULL OR l.origin = p_origin)
     AND (
       p_responsible_user_id IS NULL
       OR (p_responsible_user_id = 'unassigned' AND l.responsible_user_id IS NULL)
       OR l.responsible_user_id = p_responsible_user_id::UUID
     )
     AND (
       p_tag_ids IS NULL OR cardinality(p_tag_ids) = 0
       OR NOT EXISTS (
         SELECT 1 FROM unnest(p_tag_ids) AS tid(v)
         WHERE NOT EXISTS (
           SELECT 1 FROM lead_tag_assignments lta
            WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
         )
       )
     )
   GROUP BY l.id, l.name, l.phone, l.email
   HAVING COUNT(le.id) > 1
   ORDER BY reentry_count DESC, last_entry_at DESC
   LIMIT  p_limit
   OFFSET p_offset;
  END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION get_lead_reentries_list(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[], INT, INT, TEXT, TEXT, TEXT)
  TO authenticated;
