-- Motor de Ciclos: RPCs utilitárias (consulta, elegibilidade, seed)
-- Funções de leitura e utilitários sem side effects críticos

-- 1. Avalia se uma oportunidade está elegível para abrir novo ciclo
CREATE OR REPLACE FUNCTION public.evaluate_contact_cycle_eligibility(
  p_opportunity_id UUID,
  p_company_id     UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_config       company_contact_cycle_config%ROWTYPE;
  v_position     opportunity_funnel_positions%ROWTYPE;
  v_stage_tracks BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opportunities WHERE id = p_opportunity_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: oportunidade % nao pertence a empresa %', p_opportunity_id, p_company_id;
  END IF;

  SELECT * INTO v_config FROM company_contact_cycle_config WHERE company_id = p_company_id;
  IF NOT FOUND         THEN RETURN 'no_config'; END IF;
  IF NOT v_config.enabled THEN RETURN 'disabled'; END IF;

  SELECT * INTO v_position FROM opportunity_funnel_positions
   WHERE opportunity_id = p_opportunity_id LIMIT 1;

  SELECT fs.track_contact_attempts INTO v_stage_tracks
    FROM funnel_stages fs WHERE fs.id = v_position.stage_id;

  IF NOT COALESCE(v_stage_tracks, false) THEN RETURN 'disabled'; END IF;

  IF v_position.contact_attempts_state = 'cycle_open' THEN RETURN 'cycle_open'; END IF;

  IF v_position.eligible_for_new_cycle_at IS NOT NULL
     AND now() < v_position.eligible_for_new_cycle_at THEN
    RETURN 'waiting';
  END IF;

  RETURN 'eligible';
END;
$$;

-- 2. Retorna histórico de ciclos de uma oportunidade
CREATE OR REPLACE FUNCTION public.get_contact_cycle_history(
  p_opportunity_id UUID,
  p_company_id     UUID
)
RETURNS TABLE(
  cycle_id     UUID,
  status       TEXT,
  close_reason TEXT,
  opened_at    TIMESTAMPTZ,
  closed_at    TIMESTAMPTZ,
  attempt_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM opportunities WHERE id = p_opportunity_id AND company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: oportunidade % nao pertence a empresa %', p_opportunity_id, p_company_id;
  END IF;

  RETURN QUERY
    SELECT cac.id, cac.status, cac.close_reason, cac.opened_at, cac.closed_at,
           COUNT(ca.id) AS attempt_count
    FROM contact_attempt_cycles cac
    LEFT JOIN contact_attempts ca ON ca.cycle_id = cac.id AND ca.cancelled_at IS NULL
   WHERE cac.opportunity_id = p_opportunity_id AND cac.company_id = p_company_id
   GROUP BY cac.id, cac.status, cac.close_reason, cac.opened_at, cac.closed_at
   ORDER BY cac.opened_at DESC;
END;
$$;

-- 3. Resolve a oportunidade ativa em rastreamento para um lead (uso interno/webhook)
CREATE OR REPLACE FUNCTION public.resolve_opportunity_for_contact_cycle(
  p_lead_id    INTEGER,
  p_company_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_opportunity_id UUID;
BEGIN
  SELECT o.id
    INTO v_opportunity_id
    FROM opportunities o
    JOIN opportunity_funnel_positions ofp ON ofp.opportunity_id = o.id
    JOIN funnel_stages fs                 ON fs.id = ofp.stage_id
   WHERE o.lead_id                  = p_lead_id
     AND o.company_id               = p_company_id
     AND o.status                   = 'open'
     AND fs.track_contact_attempts  = true
   ORDER BY o.created_at DESC
   LIMIT 1;

  RETURN v_opportunity_id;
END;
$$;

-- 4. Seed de motivos padrão ao ativar Motor de Ciclos para uma empresa
CREATE OR REPLACE FUNCTION public.seed_default_contact_attempt_reasons(
  p_company_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_defaults TEXT[] := ARRAY[
    'Retorno agendado',
    'Follow-up de proposta',
    'Dúvida do cliente',
    'Negociação em andamento',
    'Sem resposta anterior',
    'Reativação de lead'
  ];
  v_label TEXT;
BEGIN
  FOREACH v_label IN ARRAY v_defaults LOOP
    INSERT INTO contact_attempt_reasons (company_id, label)
    VALUES (p_company_id, v_label)
    ON CONFLICT (company_id, label) DO NOTHING;
  END LOOP;
END;
$$;

-- Grants iniciais (corrigidos na migration 20260708100801)
GRANT EXECUTE ON FUNCTION public.evaluate_contact_cycle_eligibility(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_contact_cycle_history(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_opportunity_for_contact_cycle(INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_default_contact_attempt_reasons(UUID) TO authenticated;
