-- RPCs de aprovação e rejeição de solicitações de mudança de plano.
-- Somente platform_admin pode executar.
-- A aprovação executa UPDATE em companies.plan_id, que dispara automaticamente
-- o trigger recalculate_leads_on_plan_change já existente.

-- ── Aprovar solicitação ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_plan_change_request(
  p_request_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.plan_change_requests%ROWTYPE;
BEGIN
  IF NOT auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_request
  FROM public.plan_change_requests
  WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'request_not_found_or_not_pending');
  END IF;

  -- Alterar plano da empresa (trigger recalculate_leads_on_plan_change dispara automaticamente)
  UPDATE public.companies
  SET plan_id = v_request.to_plan_id
  WHERE id = v_request.company_id;

  -- Marcar solicitação como aprovada
  UPDATE public.plan_change_requests
  SET status = 'approved', reviewed_by = auth.uid()
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'success',    true,
    'company_id', v_request.company_id,
    'to_plan_id', v_request.to_plan_id
  );
END;
$$;

-- ── Rejeitar solicitação ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_plan_change_request(
  p_request_id UUID,
  p_notes      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.plan_change_requests%ROWTYPE;
BEGIN
  IF NOT auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT * INTO v_request
  FROM public.plan_change_requests
  WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'request_not_found_or_not_pending');
  END IF;

  UPDATE public.plan_change_requests
  SET status      = 'rejected',
      reviewed_by = auth.uid(),
      notes       = COALESCE(p_notes, notes)
  WHERE id = p_request_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ── get_plan_change_requests_admin ────────────────────────────────────────────
-- Lista todas as solicitações para o painel admin (com joins)
CREATE OR REPLACE FUNCTION public.get_plan_change_requests_admin(
  p_status TEXT DEFAULT 'pending'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN (
    SELECT jsonb_agg(row ORDER BY row.created_at DESC)
    FROM (
      SELECT
        pcr.id,
        pcr.company_id,
        pcr.status,
        pcr.notes,
        pcr.created_at,
        pcr.updated_at,
        c.name   AS company_name,
        fp.name  AS from_plan_name,
        tp.name  AS to_plan_name,
        fp.slug  AS from_plan_slug,
        tp.slug  AS to_plan_slug,
        pcr.from_plan_id,
        pcr.to_plan_id
      FROM public.plan_change_requests pcr
      JOIN public.companies c   ON c.id  = pcr.company_id
      LEFT JOIN public.plans fp ON fp.id = pcr.from_plan_id
      JOIN public.plans tp      ON tp.id = pcr.to_plan_id
      WHERE (p_status IS NULL OR pcr.status = p_status)
    ) row
  );
END;
$$;
