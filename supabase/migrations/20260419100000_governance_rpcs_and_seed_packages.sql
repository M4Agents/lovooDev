-- ============================================================
-- MIGRAÇÃO: Governança interna de pacotes e planos de IA
-- Data: 2026-04-19
--
-- O que esta migration faz:
--   1. Seed dos 4 pacotes padrão em credit_packages (idempotente por nome)
--   2. RPC get_credit_packages_admin() — pacotes + derivações, admin-only
--   3. RPC get_plans_governance()      — planos + derivações, admin-only
--
-- SEGURANÇA:
--   - Ambas as RPCs são SECURITY DEFINER
--   - Validam auth_user_is_platform_admin() antes de qualquer dado
--   - Empresa filha que chamar qualquer uma recebe RAISE EXCEPTION access_denied
--   - Campos estimados (tokens, custo, lucro) NÃO existem nas tabelas —
--     são calculados no corpo da função e nunca expostos via SELECT comum
--
-- O que NÃO muda:
--   - Tabelas company_credits, credit_transactions, ai_usage_daily
--   - RPC debit_credits_atomic, renew_company_credits
--   - AiCreditsPanel (empresa filha) — nenhum impacto
--   - RLS existente de credit_packages e plans
-- ============================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. SEED: pacotes padrão de créditos avulsos
--
-- Idempotente: só insere se o nome não existir.
-- Garante que re-execuções da migration não duplicam dados.
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO public.credit_packages (name, credits, price, is_active)
SELECT name, credits, price, is_active
FROM (VALUES
  ('Starter IA', 5000,  147.00::NUMERIC, true),
  ('Boost IA',   10000, 197.00::NUMERIC, true),
  ('Power IA',   30000, 397.00::NUMERIC, true),
  ('Scale IA',   60000, 697.00::NUMERIC, true)
) AS v(name, credits, price, is_active)
WHERE NOT EXISTS (
  SELECT 1 FROM public.credit_packages cp WHERE cp.name = v.name
);


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. RPC: get_credit_packages_admin()
--
-- Retorna todos os pacotes de créditos com campos de governança interna
-- calculados diretamente no SQL (sem novas colunas nas tabelas).
--
-- CAMPOS DERIVADOS (premissas internas — NÃO alterar sem revisar frontend):
--   estimated_tokens  = credits × 10
--   estimated_ai_cost = ROUND((credits × 10 / 1000 × 0.015), 2)
--   estimated_profit  = ROUND((price − estimated_ai_cost), 2)
--
-- ACESSO:
--   - Somente super_admin ou system_admin ativos em empresa do tipo 'parent'
--   - Empresa filha → RAISE EXCEPTION access_denied (código P0001)
--   - Retorno via SETOF TABLE: compatível com supabase.rpc() tipado
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_credit_packages_admin()
RETURNS TABLE (
  id                UUID,
  name              TEXT,
  credits           INTEGER,
  price             NUMERIC,
  is_active         BOOLEAN,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ,
  estimated_tokens  INTEGER,
  estimated_ai_cost NUMERIC,
  estimated_profit  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  -- ── Autorização: somente platform admin ──────────────────────────────────
  --
  -- auth_user_is_platform_admin() verifica:
  --   company_users.role IN ('super_admin', 'system_admin')
  --   AND companies.company_type = 'parent'
  --   AND company_users.is_active = true
  --
  -- Lança exceção (não retorna erro silencioso) para que o cliente
  -- trate o erro corretamente e não assuma retorno vazio como "sem dados".

  IF NOT public.auth_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Acesso negado: requer super_admin ou system_admin em empresa parent'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── Retornar pacotes com derivações de governança ─────────────────────────
  --
  -- Os campos estimated_* NÃO existem nas tabelas — são calculados aqui.
  -- A constante de custo (0.015 por 1k tokens) é a premissa interna atual.
  -- Se a taxa OpenAI mudar, atualizar apenas esta função.

  RETURN QUERY
  SELECT
    cp.id,
    cp.name,
    cp.credits,
    cp.price,
    cp.is_active,
    cp.created_at,
    cp.updated_at,
    -- Governança interna: NUNCA exposta via SELECT direto na tabela
    (cp.credits * 10)::INTEGER                                                 AS estimated_tokens,
    ROUND((cp.credits * 10.0 / 1000.0 * 0.015)::NUMERIC, 2)                  AS estimated_ai_cost,
    ROUND((cp.price - (cp.credits * 10.0 / 1000.0 * 0.015))::NUMERIC, 2)     AS estimated_profit
  FROM public.credit_packages cp
  ORDER BY cp.credits ASC;

END;
$$;

COMMENT ON FUNCTION public.get_credit_packages_admin() IS
  'Retorna credit_packages com campos de governança interna derivados (tokens, custo, lucro). '
  'Acesso exclusivo: super_admin ou system_admin em empresa parent. '
  'Campos estimated_* calculados no SQL — não existem nas tabelas. '
  'Empresa filha que chamar esta função recebe RAISE EXCEPTION P0001.';

REVOKE ALL ON FUNCTION public.get_credit_packages_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_credit_packages_admin() TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RPC: get_plans_governance()
--
-- Retorna planos com campos de governança interna baseados em monthly_ai_credits.
--
-- CAMPOS DERIVADOS:
--   estimated_tokens  = monthly_ai_credits × 10
--   estimated_ai_cost = ROUND((monthly_ai_credits × 10 / 1000 × 0.015), 2)
--
-- Não há "lucro estimado" para planos pois o preço de venda cobre múltiplas
-- features (não apenas IA). A governança de planos foca em custo interno.
--
-- ACESSO:
--   - Somente platform admin (igual à RPC acima)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_plans_governance()
RETURNS TABLE (
  id                  UUID,
  name                VARCHAR,
  slug                VARCHAR,
  is_active           BOOLEAN,
  price               NUMERIC,
  monthly_ai_credits  INTEGER,
  sort_order          INTEGER,
  estimated_tokens    INTEGER,
  estimated_ai_cost   NUMERIC
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
    p.id,
    p.name,
    p.slug,
    p.is_active,
    p.price,
    p.monthly_ai_credits,
    p.sort_order,
    -- Governança: custo interno do componente de IA do plano
    (p.monthly_ai_credits * 10)::INTEGER                                       AS estimated_tokens,
    ROUND((p.monthly_ai_credits * 10.0 / 1000.0 * 0.015)::NUMERIC, 2)        AS estimated_ai_cost
  FROM public.plans p
  ORDER BY p.sort_order ASC, p.name ASC;

END;
$$;

COMMENT ON FUNCTION public.get_plans_governance() IS
  'Retorna plans com campos de governança interna derivados (tokens e custo estimado de IA). '
  'Não inclui lucro estimado pois o preço do plano cobre múltiplas features. '
  'Acesso exclusivo: super_admin ou system_admin em empresa parent. '
  'Campos estimated_* calculados no SQL — não existem nas tabelas.';

REVOKE ALL ON FUNCTION public.get_plans_governance() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_plans_governance() TO authenticated;
