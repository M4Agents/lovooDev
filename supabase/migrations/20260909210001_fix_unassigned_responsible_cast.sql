-- =====================================================
-- MIGRATION: Evitar cast 'unassigned'::UUID nas RPCs de stats
-- Data: 09/09/2026
--
-- Problema:
--   p_responsible_user_id = 'unassigned' era comparado com
--   l.responsible_user_id = p_responsible_user_id::UUID no mesmo OR.
--   Postgres não garante short-circuit e o cast invalida a query inteira
--   (invalid input syntax for type uuid). O Promise.all da página de Leads
--   rejeitava e a lista não atualizava.
--
-- Correção:
--   Resolver o UUID uma vez no BEGIN, só quando o valor não é 'unassigned'.
--   Sem alteração de assinatura, SECURITY DEFINER ou RLS.
-- =====================================================

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. get_lead_dashboard_stats
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
  v_total_leads         BIGINT;
  v_total_entries       BIGINT;
  v_new_leads           BIGINT;
  v_reentry_leads       BIGINT;
  v_filter_unassigned   BOOLEAN;
  v_responsible_uuid    UUID;
BEGIN
  v_filter_unassigned := (p_responsible_user_id IS NOT NULL AND p_responsible_user_id = 'unassigned');
  v_responsible_uuid := NULL;
  IF p_responsible_user_id IS NOT NULL AND NOT v_filter_unassigned THEN
    v_responsible_uuid := p_responsible_user_id::UUID;
  END IF;

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
       OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
       OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
         OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
         OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
             OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
             OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
         OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
         OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
         OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
         OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
             OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
             OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
         OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
         OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
         OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
         OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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

    v_new_leads := v_total_leads;

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
             OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
             OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
-- 2. get_lead_reentries_list
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
DECLARE
  v_filter_unassigned BOOLEAN;
  v_responsible_uuid  UUID;
BEGIN
  v_filter_unassigned := (p_responsible_user_id IS NOT NULL AND p_responsible_user_id = 'unassigned');
  v_responsible_uuid := NULL;
  IF p_responsible_user_id IS NOT NULL AND NOT v_filter_unassigned THEN
    v_responsible_uuid := p_responsible_user_id::UUID;
  END IF;

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
       OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
       OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
       OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
       OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
       OR (v_filter_unassigned AND l.responsible_user_id IS NULL)
       OR (v_responsible_uuid IS NOT NULL AND l.responsible_user_id = v_responsible_uuid)
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
GRANT EXECUTE ON FUNCTION get_lead_dashboard_stats(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[], TEXT, TEXT, TEXT)
  TO authenticated;
