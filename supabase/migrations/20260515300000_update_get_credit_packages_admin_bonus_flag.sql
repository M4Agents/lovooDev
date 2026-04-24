-- =============================================================================
-- Migration: update_get_credit_packages_admin_bonus_flag
-- Timestamp: 20260515300000
--
-- Atualiza get_credit_packages_admin() para incluir os campos:
--   is_available_for_sale  — já existia na tabela, mas não estava no retorno da RPC
--   is_available_for_bonus — adicionado em 20260515100000_consulting_packages_module
--
-- Retrocompatível: mesmos campos anteriores + 2 novos ao final.
-- O frontend que já usava a RPC não é afetado — os novos campos são extras.
-- =============================================================================

DROP FUNCTION IF EXISTS public.get_credit_packages_admin();

CREATE FUNCTION public.get_credit_packages_admin()
RETURNS TABLE (
  id                    UUID,
  name                  TEXT,
  credits               INTEGER,
  price                 NUMERIC,
  is_active             BOOLEAN,
  is_available_for_sale BOOLEAN,
  is_available_for_bonus BOOLEAN,
  created_at            TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ,
  estimated_tokens      INTEGER,
  estimated_ai_cost     NUMERIC,
  estimated_profit      NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: requer super_admin ou system_admin em empresa parent'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    cp.name,
    cp.credits,
    cp.price,
    cp.is_active,
    cp.is_available_for_sale,
    cp.is_available_for_bonus,
    cp.created_at,
    cp.updated_at,
    (cp.credits * 10)::INTEGER                                             AS estimated_tokens,
    ROUND((cp.credits * 10.0 / 1000.0 * 0.015)::NUMERIC, 2)              AS estimated_ai_cost,
    ROUND((cp.price - (cp.credits * 10.0 / 1000.0 * 0.015))::NUMERIC, 2) AS estimated_profit
  FROM public.credit_packages cp
  ORDER BY cp.credits ASC;

END;
$$;

COMMENT ON FUNCTION public.get_credit_packages_admin() IS
  'Retorna credit_packages com campos de governança interna derivados (tokens, custo, lucro). '
  'Inclui is_available_for_sale e is_available_for_bonus para gestão no painel admin. '
  'Acesso exclusivo: super_admin ou system_admin em empresa parent.';

REVOKE ALL ON FUNCTION public.get_credit_packages_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_credit_packages_admin() TO authenticated;
