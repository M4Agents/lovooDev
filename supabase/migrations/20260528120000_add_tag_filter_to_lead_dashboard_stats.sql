-- MIGRATION: Adicionar filtro por tags à get_lead_dashboard_stats
--
-- Problema: ao filtrar leads por tags na tela de Leads, os cards
--           "Total de Leads" e "Entradas de Leads" continuavam mostrando
--           o total global da empresa, sem aplicar o filtro de tags.
--
-- Solução: adicionar p_tag_ids UUID[] DEFAULT NULL.
--          Modo sempre AND (lead deve ter TODAS as tags selecionadas),
--          espelhando a lógica de getLeads em api.ts.
--          NULL ou array vazio = sem filtro (comportamento legado mantido).
--
-- Segurança multi-tenant: p_tag_ids não contém company_id; a função já
-- filtra por p_company_id nas tabelas leads e lead_entries.
-- A subquery de tags não precisa revalidar company_id porque lead_tag_assignments
-- referencia leads que já foram filtrados por company_id.

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
  v_total_leads   BIGINT;
  v_total_entries BIGINT;
BEGIN
  -- Helper inline: lead passa no filtro de tags quando
  --   p_tag_ids é NULL, vazio, ou lead possui TODAS as tags (AND).
  -- Usado como bloco reutilizado nos dois SELECTs abaixo.

  -- Total de identidades únicas ativas (sem filtro de período)
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
           SELECT 1
           FROM lead_tag_assignments lta
           WHERE lta.lead_id = l.id
             AND lta.tag_id  = tid.v
         )
       )
     );

  -- Total de entradas de leads ativos com filtro de período e tags
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
         p_tag_ids IS NULL
         OR cardinality(p_tag_ids) = 0
         OR NOT EXISTS (
           SELECT 1
           FROM unnest(p_tag_ids) AS tid(v)
           WHERE NOT EXISTS (
             SELECT 1
             FROM lead_tag_assignments lta
             WHERE lta.lead_id = l.id
               AND lta.tag_id  = tid.v
           )
         )
       );

  ELSIF p_start_date IS NOT NULL THEN
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND le.created_at >= p_start_date
       AND (
         p_tag_ids IS NULL
         OR cardinality(p_tag_ids) = 0
         OR NOT EXISTS (
           SELECT 1
           FROM unnest(p_tag_ids) AS tid(v)
           WHERE NOT EXISTS (
             SELECT 1
             FROM lead_tag_assignments lta
             WHERE lta.lead_id = l.id
               AND lta.tag_id  = tid.v
           )
         )
       );

  ELSE
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at  IS NULL
       AND (
         p_tag_ids IS NULL
         OR cardinality(p_tag_ids) = 0
         OR NOT EXISTS (
           SELECT 1
           FROM unnest(p_tag_ids) AS tid(v)
           WHERE NOT EXISTS (
             SELECT 1
             FROM lead_tag_assignments lta
             WHERE lta.lead_id = l.id
               AND lta.tag_id  = tid.v
           )
         )
       );
  END IF;

  RETURN jsonb_build_object(
    'total_leads',   v_total_leads,
    'total_entries', v_total_entries
  );
END;
$$;
