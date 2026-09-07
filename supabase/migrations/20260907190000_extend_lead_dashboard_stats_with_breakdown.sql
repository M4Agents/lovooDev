-- =====================================================
-- MIGRATION: Estender get_lead_dashboard_stats com breakdown
-- Data: 07/09/2026
-- Novos campos retornados:
--   new_leads      → leads distintos cuja PRIMEIRA entrada ever caiu no período
--   reentry_leads  → leads distintos que já existiam antes do período e voltaram
--
-- Quando sem filtro de período:
--   new_leads     = total de leads únicos (cada lead tem uma primeira entrada)
--   reentry_leads = leads com mais de 1 entrada (total histórico)
-- =====================================================

CREATE OR REPLACE FUNCTION get_lead_dashboard_stats(
  p_company_id  UUID,
  p_start_date  TIMESTAMPTZ DEFAULT NULL,
  p_end_date    TIMESTAMPTZ DEFAULT NULL,
  p_tag_ids     UUID[]      DEFAULT NULL
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

  -- ── Total de identidades únicas ativas (sem filtro de período) ──────────
  SELECT COUNT(*)
    INTO v_total_leads
    FROM leads l
   WHERE l.company_id = p_company_id
     AND l.deleted_at IS NULL
     AND (
       p_tag_ids IS NULL
       OR cardinality(p_tag_ids) = 0
       OR NOT EXISTS (
         SELECT 1
         FROM unnest(p_tag_ids) AS tid(v)
         WHERE NOT EXISTS (
           SELECT 1 FROM lead_tag_assignments lta
            WHERE lta.lead_id = l.id AND lta.tag_id = tid.v
         )
       )
     );

  -- ── Total de entradas de leads ativos (com filtro de período e tags) ────
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND le.created_at >= p_start_date
       AND le.created_at <= p_end_date
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

    -- ── Novos: leads cuja primeira entrada EVER caiu dentro do período ──
    SELECT COUNT(*)
      INTO v_new_leads
      FROM (
        SELECT le.lead_id
          FROM lead_entries le
          JOIN leads l ON l.id = le.lead_id
         WHERE le.company_id = p_company_id
           AND l.deleted_at  IS NULL
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

    -- ── Reentradas: leads que já tinham entrada antes do período e voltaram
    SELECT COUNT(DISTINCT le.lead_id)
      INTO v_reentry_leads
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND le.created_at >= p_start_date
       AND le.created_at <= p_end_date
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
    -- Apenas start, sem end
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND le.created_at >= p_start_date
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
    -- Sem filtro de período: total histórico
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
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

    -- Sem período: new_leads = total de leads únicos (todo lead tem uma primeira entrada)
    v_new_leads := v_total_leads;

    -- Sem período: reentry_leads = leads com mais de 1 entrada total
    SELECT COUNT(*)
      INTO v_reentry_leads
      FROM (
        SELECT le.lead_id
          FROM lead_entries le
          JOIN leads l ON l.id = le.lead_id
         WHERE le.company_id = p_company_id
           AND l.deleted_at  IS NULL
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
