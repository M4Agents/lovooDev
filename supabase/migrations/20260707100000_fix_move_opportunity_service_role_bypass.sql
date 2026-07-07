-- =====================================================
-- MIGRATION: Fix move_opportunity — bypass guard para service_role
-- Data: 07/07/2026
--
-- Problema:
--   O guard adicionado em 20260623450000_add_guards_kanban_rpcs.sql
--   verifica auth_user_can_access_funnel(), que usa auth.uid() internamente.
--   Quando a RPC é chamada via service_role (motor de automação backend),
--   auth.uid() retorna NULL → todos os grupos do helper falham → UNAUTHORIZED.
--
-- Correção:
--   Adicionar condição `auth.uid() IS NOT NULL` antes do guard.
--   Chamadas de usuários autenticados (auth.uid() presente): guard aplicado normalmente.
--   Chamadas de service_role (auth.uid() NULL): guard ignorado — contexto confiável.
--
-- Segurança:
--   service_role já bypassa RLS inteiramente — conceder bypass no guard é consistente
--   com o modelo de confiança existente.
--   O motor de automação valida company_id antes de chamar a RPC.
--   Nenhuma outra lógica da função é alterada.
-- =====================================================

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

  -- ── Guard: acesso ao funil ────────────────────────────────────────────
  -- Aplicado apenas para usuários autenticados (auth.uid() IS NOT NULL).
  -- Chamadas via service_role (auth.uid() IS NULL) são confiáveis e bypass
  -- é consistente com o modelo de segurança existente (service_role já
  -- ignora RLS). Fix para o motor de automação backend.
  IF auth.uid() IS NOT NULL AND NOT auth_user_can_access_funnel(v_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
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

COMMENT ON FUNCTION move_opportunity(UUID, UUID, UUID, UUID, INTEGER) IS
  'Move uma oportunidade de etapa dentro de um funil de forma atômica. '
  'Guard de acesso ao funil aplicado apenas para usuários autenticados (auth.uid() IS NOT NULL). '
  'Chamadas via service_role (motor de automação) bypass o guard — consistente com modelo de confiança do service_role.';
