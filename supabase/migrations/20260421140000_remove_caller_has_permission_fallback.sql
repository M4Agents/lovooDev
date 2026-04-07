-- =====================================================
-- MIGRATION: Remove fallback por role da caller_has_permission
-- Data: 21/04/2026
-- Objetivo: Tornar a RPC RBAC puro — sem caminho de escape
--           por role string. permissions é a única fonte de verdade.
-- Pré-requisito validado: needs_backfill = 0 (todos os 8 ativos
--           têm permissions completo — backfill Ciclo 1).
-- Bloco A / Fase 1 — Ciclo RBAC 2.
-- =====================================================

CREATE OR REPLACE FUNCTION public.caller_has_permission(
  p_company_id     uuid,
  p_permission_key text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_permissions jsonb;
BEGIN
  SELECT cu.permissions
  INTO   v_permissions
  FROM   public.company_users cu
  WHERE  cu.user_id    = auth.uid()
    AND  cu.company_id = p_company_id
    AND  cu.is_active  = true;

  -- Usuário sem registro ativo nessa empresa: negar acesso
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- RBAC puro: lê exclusivamente da coluna permissions armazenada.
  -- Sem bypass por role. Sem fallback por role.
  -- Chave ausente no JSONB retorna false (comportamento conservador e seguro).
  RETURN COALESCE((v_permissions ->> p_permission_key)::boolean, false);
END;
$$;

COMMENT ON FUNCTION public.caller_has_permission IS
  'Verifica permission da coluna company_users.permissions para o usuário autenticado (auth.uid()). '
  'RBAC puro: sem bypass por role, sem fallback. '
  'Chave ausente retorna false. '
  'Ciclo RBAC 2 / Bloco A / Fase 1 — 21/04/2026.';
