-- =====================================================
-- MIGRATION: WEBHOOK RESOLVE AWS CREDENTIALS
-- Data: 17/04/2026
-- Objetivo: Resolver credencial AWS com fallback mãe → filha
-- =====================================================
-- Nova RPC que substitui webhook_get_aws_credentials no credentialsManager.
-- Centraliza a regra de herança de credencial no banco (SECURITY DEFINER).
-- Empresas filhas sem credencial própria herdam a credencial da empresa mãe.
-- O company_id da filha continua sendo usado para path S3 e banco de dados.
-- =====================================================

CREATE OR REPLACE FUNCTION public.webhook_resolve_aws_credentials(
  p_company_id UUID
)
RETURNS TABLE (
  id                UUID,
  company_id        UUID,
  access_key_id     TEXT,
  secret_access_key TEXT,
  region            TEXT,
  bucket            TEXT,
  is_active         BOOLEAN,
  created_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_company_id UUID;
BEGIN

  -- Passo 1: Buscar credencial ativa da própria empresa
  IF EXISTS (
    SELECT 1 FROM aws_credentials ac
    WHERE ac.company_id = p_company_id
      AND ac.is_active = true
  ) THEN
    RETURN QUERY
      SELECT
        ac.id,
        ac.company_id,
        ac.access_key_id,
        ac.secret_access_key,
        ac.region,
        ac.bucket,
        ac.is_active,
        ac.created_at,
        ac.updated_at
      FROM aws_credentials ac
      WHERE ac.company_id = p_company_id
        AND ac.is_active = true
      ORDER BY ac.created_at DESC
      LIMIT 1;
    RETURN;
  END IF;

  -- Passo 2: Credencial própria não encontrada — buscar empresa mãe
  SELECT c.parent_company_id INTO v_parent_company_id
  FROM companies c
  WHERE c.id = p_company_id;

  -- Passo 3: Se existir empresa mãe, tentar credencial da mãe
  IF v_parent_company_id IS NOT NULL THEN
    RETURN QUERY
      SELECT
        ac.id,
        ac.company_id,
        ac.access_key_id,
        ac.secret_access_key,
        ac.region,
        ac.bucket,
        ac.is_active,
        ac.created_at,
        ac.updated_at
      FROM aws_credentials ac
      WHERE ac.company_id = v_parent_company_id
        AND ac.is_active = true
      ORDER BY ac.created_at DESC
      LIMIT 1;
  END IF;

  -- Passo 4: Retorna array vazio se nenhuma credencial encontrada na hierarquia
  -- credentialsManager trata data.length === 0 com erro explícito (comportamento atual preservado)

END;
$$;

-- =====================================================
-- GRANTS — mesmo padrão das RPCs existentes do projeto
-- =====================================================
GRANT EXECUTE ON FUNCTION public.webhook_resolve_aws_credentials(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.webhook_resolve_aws_credentials(UUID) TO service_role;

-- =====================================================
-- DOCUMENTAÇÃO
-- =====================================================
COMMENT ON FUNCTION public.webhook_resolve_aws_credentials(UUID) IS
'Resolve credenciais AWS com fallback mãe → filha. Tenta credencial da empresa informada (Passo 1); se não encontrar, busca parent_company_id em companies (Passo 2) e usa credencial da mãe (Passo 3). Retorna array vazio se nenhuma credencial existir na hierarquia. SECURITY DEFINER + SET search_path = public por segurança. Substitui webhook_get_aws_credentials no credentialsManager.ts.';
