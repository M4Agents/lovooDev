-- MIGRATION: Corrigir get_lead_dashboard_stats para ignorar lead_entries de leads soft-deletados
--
-- Problema: total_entries contava entradas de leads com deleted_at IS NOT NULL,
--           gerando divergência entre total_leads (filtrado) e total_entries (não filtrado).
--
-- Solução: adicionar JOIN com leads e filtrar deleted_at IS NULL em todos os blocos da função.
-- Dados históricos permanecem no banco — apenas a contagem operacional é corrigida.

CREATE OR REPLACE FUNCTION get_lead_dashboard_stats(
  p_company_id  UUID,
  p_start_date  TIMESTAMPTZ DEFAULT NULL,
  p_end_date    TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_total_leads   BIGINT;
  v_total_entries BIGINT;
BEGIN
  -- Identidades únicas ativas: sem filtro de período
  SELECT COUNT(*)
    INTO v_total_leads
    FROM leads
   WHERE company_id = p_company_id
     AND deleted_at IS NULL;

  -- Entradas de leads ativos: com filtro de período se fornecido
  -- Usa idx_lead_entries_company_created (company_id, created_at)
  -- JOIN garante que entradas de leads soft-deletados não são contadas
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at IS NULL
       AND le.created_at >= p_start_date
       AND le.created_at <= p_end_date;

  ELSIF p_start_date IS NOT NULL THEN
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at IS NULL
       AND le.created_at >= p_start_date;

  ELSE
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries le
      JOIN leads l ON l.id = le.lead_id
     WHERE le.company_id = p_company_id
       AND l.deleted_at IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'total_leads',   v_total_leads,
    'total_entries', v_total_entries
  );
END;
$$;
