-- =====================================================
-- MIGRATION: Fix webhook_resolve_aws_credentials GRANT
-- Data: 2026-05-22
--
-- Problema:
--   A RPC webhook_resolve_aws_credentials tinha GRANT apenas para
--   anon e service_role. O frontend chama a função com role
--   'authenticated' (usuário logado), causando permission denied
--   silencioso e impedindo o upload de arquivos para todos os
--   usuários, incluindo vendedores de empresas filhas.
--
-- Correção:
--   1. Adicionar GRANT EXECUTE TO authenticated
--   2. Adicionar validação de membership para chamadas authenticated:
--      o usuário deve ser membro ativo da empresa (Trilha 1) ou
--      super_admin/system_admin da empresa mãe (Trilha 2).
--      Sem validação, qualquer usuário logado poderia passar qualquer
--      company_id e obter credenciais AWS de empresas sem vínculo.
--   3. Chamadas anon/service_role (webhooks/backend) continuam sem
--      validação de usuário — comportamento atual preservado.
--
-- Impacto:
--   - Upload de arquivos no chat passa a funcionar para usuários logados
--   - Nenhuma mudança no fallback filha → mãe
--   - Nenhuma mudança na biblioteca de mídias ou fluxo de isolamento
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

  -- Validação de membership para usuários autenticados (frontend).
  -- Webhooks e backend usam anon/service_role e passam sem verificação
  -- de usuário (sem auth.uid() disponível nesse contexto).
  IF auth.role() = 'authenticated' THEN
    IF NOT (
      public.auth_user_is_company_member(p_company_id)
      OR public.auth_user_is_parent_admin(p_company_id)
    ) THEN
      RAISE EXCEPTION 'Acesso negado: usuário não é membro desta empresa'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

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
  -- credentialsManager trata data.length === 0 com erro explícito (comportamento preservado)

END;
$$;

-- =====================================================
-- GRANTS
-- =====================================================
GRANT EXECUTE ON FUNCTION public.webhook_resolve_aws_credentials(UUID) TO anon;
GRANT EXECUTE ON FUNCTION public.webhook_resolve_aws_credentials(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.webhook_resolve_aws_credentials(UUID) TO service_role;

-- =====================================================
-- DOCUMENTAÇÃO
-- =====================================================
COMMENT ON FUNCTION public.webhook_resolve_aws_credentials(UUID) IS
'Resolve credenciais AWS com fallback mãe → filha. Tenta credencial da empresa informada (Passo 1); se não encontrar, busca parent_company_id em companies (Passo 2) e usa credencial da mãe (Passo 3). Retorna array vazio se nenhuma credencial existir na hierarquia. Para chamadas authenticated (frontend): valida membership via auth_user_is_company_member ou auth_user_is_parent_admin antes de retornar credenciais. Para anon/service_role (webhooks/backend): sem validação de usuário. SECURITY DEFINER + SET search_path = public por segurança.';
