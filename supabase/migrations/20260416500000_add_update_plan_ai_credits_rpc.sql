-- ============================================================
-- MIGRAÇÃO: RPC update_plan_ai_credits
-- Data: 2026-04-16
-- Objetivo: Permitir que admins de empresa pai atualizem
--           plans.monthly_ai_credits sem depender de RLS legado.
-- Segurança: SECURITY DEFINER + validação via auth_user_is_platform_admin()
-- Impacto: zero em outras tabelas ou policies existentes
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_plan_ai_credits(
  p_plan_id UUID,
  p_credits  INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_exists BOOLEAN;
BEGIN
  -- ── 1. Autorização ────────────────────────────────────────────────────────
  -- Apenas super_admin ou system_admin ativos em empresa do tipo 'parent'
  IF NOT public.auth_user_is_platform_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acesso negado');
  END IF;

  -- ── 2. Validação de entrada ───────────────────────────────────────────────
  IF p_credits < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Créditos não podem ser negativos');
  END IF;

  -- ── 3. Verificar existência do plano ─────────────────────────────────────
  SELECT EXISTS (SELECT 1 FROM public.plans WHERE id = p_plan_id)
  INTO v_plan_exists;

  IF NOT v_plan_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Plano não encontrado');
  END IF;

  -- ── 4. Atualizar ─────────────────────────────────────────────────────────
  UPDATE public.plans
  SET
    monthly_ai_credits = p_credits,
    updated_at         = NOW(),
    updated_by         = auth.uid()
  WHERE id = p_plan_id;

  RETURN jsonb_build_object('ok', true);

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.update_plan_ai_credits(UUID, INTEGER) IS
'Atualiza monthly_ai_credits de um plano. Requer super_admin ou system_admin ativo
em empresa do tipo parent (auth_user_is_platform_admin). SECURITY DEFINER:
bypassa RLS da tabela plans, mantendo validação explícita no corpo da função.';

-- Revogar acesso público (executável apenas via Supabase client autenticado)
REVOKE ALL ON FUNCTION public.update_plan_ai_credits(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_plan_ai_credits(UUID, INTEGER) TO authenticated;
