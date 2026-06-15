-- =============================================================================
-- Fase 2a: RPC update_instance_assigned_user
-- Data: 2026-06-15
--
-- Objetivo:
--   Permitir que usuários com role administrativo configurem o responsável
--   padrão de uma instância WhatsApp. O responsável será atribuído
--   automaticamente aos leads criados por essa instância via webhook.
--
-- Segurança:
--   SECURITY DEFINER: executa com privilégios do owner, bypassa RLS.
--   Toda autorização é feita explicitamente dentro da função.
--   Nenhum UPDATE direto via frontend — escrita exclusiva por esta RPC.
--
-- Roles autorizados: super_admin, system_admin, admin, manager.
-- Roles bloqueados:  seller, partner e qualquer outro.
--
-- Idempotência: CREATE OR REPLACE.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.update_instance_assigned_user(
  p_instance_id      uuid,
  p_company_id       uuid,
  p_assigned_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id      uuid := auth.uid();
  v_caller_role    text;
  v_instance_exists boolean;
BEGIN
  -- ── 1. Autenticação ────────────────────────────────────────────────────────
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Não autenticado'
    );
  END IF;

  -- ── 2 + 3. Instância existe, pertence à empresa e não está deletada ────────
  SELECT EXISTS (
    SELECT 1
    FROM   whatsapp_life_instances
    WHERE  id         = p_instance_id
      AND  company_id = p_company_id
      AND  deleted_at IS NULL
  ) INTO v_instance_exists;

  IF NOT v_instance_exists THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Instância não encontrada ou não pertence à empresa'
    );
  END IF;

  -- ── 4. Caller é membro ativo da empresa ────────────────────────────────────
  SELECT role INTO v_caller_role
  FROM   company_users
  WHERE  user_id    = v_caller_id
    AND  company_id = p_company_id
    AND  is_active  = true;

  IF v_caller_role IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Sem acesso à empresa'
    );
  END IF;

  -- ── 5. Role autorizado ─────────────────────────────────────────────────────
  IF v_caller_role NOT IN ('super_admin', 'system_admin', 'admin', 'manager') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Permissão insuficiente. Roles permitidos: super_admin, system_admin, admin, manager'
    );
  END IF;

  -- ── 6. Usuário a atribuir é membro ativo da mesma empresa (quando não NULL) ─
  IF p_assigned_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM   company_users
      WHERE  user_id    = p_assigned_user_id
        AND  company_id = p_company_id
        AND  is_active  = true
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'Usuário não é membro ativo da empresa'
      );
    END IF;
  END IF;

  -- ── 7 + 8. UPDATE com tripla validação na cláusula WHERE ──────────────────
  -- id + company_id + deleted_at IS NULL: nenhum caminho permite alterar
  -- instâncias de outra empresa ou instâncias soft-deletadas.
  UPDATE whatsapp_life_instances
  SET    assigned_user_id = p_assigned_user_id,
         updated_at       = NOW()
  WHERE  id         = p_instance_id
    AND  company_id = p_company_id
    AND  deleted_at IS NULL;

  -- ── 9. Retorno ─────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',          true,
    'instance_id',      p_instance_id,
    'assigned_user_id', p_assigned_user_id,
    'message',          CASE
                          WHEN p_assigned_user_id IS NOT NULL
                          THEN 'Responsável atribuído com sucesso'
                          ELSE 'Responsável removido com sucesso'
                        END
  );

EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'update_instance_assigned_user: ERRO instance=% company=% — %',
    p_instance_id, p_company_id, SQLERRM;
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM
  );
END;
$$;

COMMENT ON FUNCTION public.update_instance_assigned_user IS
'Configura o usuário responsável padrão de uma instância WhatsApp. '
'Roles autorizados: super_admin, system_admin, admin, manager. '
'p_assigned_user_id = NULL remove o responsável. '
'Toda escrita em whatsapp_life_instances.assigned_user_id deve passar por esta RPC.';
