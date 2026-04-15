-- MIGRATION: RPC otimizada para métricas do dashboard de Leads
--
-- Substitui agregação em JS no cliente por query server-side com índices.
-- total_leads: count em leads (sem período — identidades únicas)
-- total_entries: count em lead_entries (com período opcional)
--
-- Performance:
--   total_leads usa índice primário de leads + eq(company_id) + is(deleted_at, null)
--   total_entries usa índice idx_lead_entries_company_created (company_id, created_at)
--   Não retorna listas, apenas agregação.
--
-- Futura otimização (não implementar agora):
--   Se lead_entries ultrapassar ~5M linhas/empresa, considerar materialized view
--   com refresh periódico. A RPC é o ponto único de troca sem alterar o frontend.
--
-- Segurança:
--   Sem SECURITY DEFINER — a RPC opera sob RLS normal (anon/authenticated).
--   A tabela lead_entries tem policy SELECT para auth_user_is_company_member.
--   A tabela leads tem RLS ativo com policies de member/admin.
--   Portanto a função roda com os privilégios do caller, respeitando RLS.

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
  -- Identidades únicas: sem filtro de período
  SELECT COUNT(*)
    INTO v_total_leads
    FROM leads
   WHERE company_id = p_company_id
     AND deleted_at IS NULL;

  -- Entradas: com filtro de período se fornecido
  -- Usa idx_lead_entries_company_created (company_id, created_at)
  IF p_start_date IS NOT NULL AND p_end_date IS NOT NULL THEN
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries
     WHERE company_id = p_company_id
       AND created_at >= p_start_date
       AND created_at <= p_end_date;
  ELSIF p_start_date IS NOT NULL THEN
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries
     WHERE company_id = p_company_id
       AND created_at >= p_start_date;
  ELSE
    SELECT COUNT(*)
      INTO v_total_entries
      FROM lead_entries
     WHERE company_id = p_company_id;
  END IF;

  RETURN jsonb_build_object(
    'total_leads',   v_total_leads,
    'total_entries', v_total_entries
  );
END;
$$;
