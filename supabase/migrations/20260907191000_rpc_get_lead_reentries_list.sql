-- =====================================================
-- MIGRATION: RPC get_lead_reentries_list
-- Data: 07/09/2026
-- Retorna lista paginada de leads que tiveram reentradas
-- no período selecionado (ou no histórico completo).
--
-- Campos retornados:
--   lead_id, lead_name, lead_phone, lead_email
--   reentry_count  → qtd de reentradas no período (ou total histórico - 1)
--   last_entry_at  → data da última entrada no período (ou all-time)
--
-- Segurança: sem SECURITY DEFINER — corre sob RLS do caller.
--   leads e lead_entries têm policies de company_member.
-- =====================================================

CREATE OR REPLACE FUNCTION get_lead_reentries_list(
  p_company_id  UUID,
  p_start_date  TIMESTAMPTZ DEFAULT NULL,
  p_end_date    TIMESTAMPTZ DEFAULT NULL,
  p_tag_ids     UUID[]      DEFAULT NULL,
  p_limit       INT         DEFAULT 100,
  p_offset      INT         DEFAULT 0
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
    -- ── Com período: leads que voltaram dentro do intervalo ─────────────
    -- reentry_count = entradas do lead no período (todas são reentradas, pois
    --                 o lead já existia antes de p_start_date)
    RETURN QUERY
    SELECT
      l.id::INT,
      l.name::TEXT,
      l.phone::TEXT,
      l.email::TEXT,
      COUNT(le.id)::BIGINT                AS reentry_count,
      MAX(le.created_at)                  AS last_entry_at
    FROM lead_entries le
    JOIN leads l ON l.id = le.lead_id
   WHERE le.company_id = p_company_id
     AND l.deleted_at  IS NULL
     AND le.created_at >= p_start_date
     AND le.created_at <= p_end_date
     -- Lead deve ter pelo menos uma entrada ANTES do período (é reentrada, não nova)
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
    -- ── Apenas start, sem end ────────────────────────────────────────────
    RETURN QUERY
    SELECT
      l.id::INT,
      l.name::TEXT,
      l.phone::TEXT,
      l.email::TEXT,
      COUNT(le.id)::BIGINT                AS reentry_count,
      MAX(le.created_at)                  AS last_entry_at
    FROM lead_entries le
    JOIN leads l ON l.id = le.lead_id
   WHERE le.company_id = p_company_id
     AND l.deleted_at  IS NULL
     AND le.created_at >= p_start_date
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
    -- ── Sem período: leads com mais de 1 entrada no histórico ────────────
    -- reentry_count = total de entradas - 1 (exclui a primeira)
    RETURN QUERY
    SELECT
      l.id::INT,
      l.name::TEXT,
      l.phone::TEXT,
      l.email::TEXT,
      (COUNT(le.id) - 1)::BIGINT          AS reentry_count,
      MAX(le.created_at)                  AS last_entry_at
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
   GROUP BY l.id, l.name, l.phone, l.email
   HAVING COUNT(le.id) > 1
   ORDER BY reentry_count DESC, last_entry_at DESC
   LIMIT  p_limit
   OFFSET p_offset;
  END IF;

END;
$$;

-- Garantir acesso a usuários autenticados
GRANT EXECUTE ON FUNCTION get_lead_reentries_list(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID[], INT, INT)
  TO authenticated;
