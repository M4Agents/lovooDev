-- Migration: permite que super_admin e system_admin da empresa pai
-- acessem chat de empresas filhas durante interpolação (Trilha 2).
--
-- RPCs corrigidas:
--   1. chat_get_conversations    — remover gate com companies.user_id (legado)
--   2. chat_assign_conversation  — remover gate com companies.user_id (legado)
--
-- Padrão aplicado (igual ao já aprovado em get_company_users_with_details):
--   Trilha 1: membership direto em company_users
--   Trilha 2: auth_user_is_parent_admin (super_admin / system_admin da empresa pai)

-- ─── 1. chat_get_conversations ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_get_conversations(
  p_company_id   uuid,
  p_user_id      uuid,
  p_filter_type  character varying,
  p_instance_id  uuid    DEFAULT NULL::uuid,
  p_limit        integer DEFAULT 50,
  p_offset       integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conversations jsonb;
  v_has_access    boolean;
BEGIN
  -- Trilha 1: membership direto
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE company_id = p_company_id
      AND user_id    = p_user_id
      AND is_active  = true
  ) INTO v_has_access;

  -- Trilha 2: super_admin / system_admin da empresa pai
  IF NOT v_has_access THEN
    SELECT public.auth_user_is_parent_admin(p_company_id) INTO v_has_access;
  END IF;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Acesso negado à empresa'
    );
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',                    ccl.id,
      'company_id',            ccl.company_id,
      'instance_id',           ccl.instance_id,
      'contact_phone',         CASE
                                 WHEN COALESCE(l.is_over_plan, false) THEN NULL
                                 ELSE ccl.contact_phone
                               END,
      'contact_name',          ccl.contact_name,
      'lead_id',               ccl.lead_id,
      'profile_picture_url',   ccl.profile_picture_url,
      'company_name',          ccl.company_name,
      'is_lead_over_plan',     COALESCE(l.is_over_plan, false),
      'ai_state',              cc.ai_state,
      'ai_assignment_id',      cc.ai_assignment_id,
      'assigned_to',           CASE
                                 WHEN ccl.assigned_to IS NOT NULL THEN
                                   jsonb_build_object(
                                     'id',    ccl.assigned_to,
                                     'email', au.email
                                   )
                                 ELSE NULL
                               END,
      'last_message_at',       ccl.last_message_at,
      'last_message_content',  CASE
                                 WHEN COALESCE(l.is_over_plan, false) THEN NULL
                                 ELSE ccl.last_message_content
                               END,
      'last_message_direction', ccl.last_message_direction,
      'unread_count',          ccl.unread_count,
      'status',                ccl.status,
      'instance_name',         COALESCE(wli.instance_name, 'Instância Desconectada'),
      'instance_status',       COALESCE(wli.status, 'disconnected'),
      'instance_deleted',      CASE WHEN wli.deleted_at IS NOT NULL THEN true ELSE false END,
      'created_at',            ccl.created_at,
      'updated_at',            ccl.updated_at
    ) ORDER BY ccl.last_message_at DESC NULLS LAST
  ) INTO v_conversations
  FROM chat_conversations_with_leads ccl
  LEFT JOIN auth.users                au  ON ccl.assigned_to  = au.id
  LEFT JOIN whatsapp_life_instances   wli ON ccl.instance_id  = wli.id
  LEFT JOIN chat_conversations        cc  ON cc.id            = ccl.id
  LEFT JOIN leads                     l   ON l.id             = ccl.lead_id AND l.deleted_at IS NULL
  WHERE ccl.company_id = p_company_id
    AND (
      p_instance_id IS NULL OR
      ccl.instance_id = p_instance_id OR
      (ccl.instance_id IS NULL AND p_instance_id IS NULL)
    )
    AND CASE
          WHEN p_filter_type = 'assigned'   THEN ccl.assigned_to = p_user_id
          WHEN p_filter_type = 'unassigned' THEN ccl.assigned_to IS NULL
          ELSE TRUE
        END
    AND ccl.status = 'active'
  LIMIT p_limit OFFSET p_offset;

  RETURN jsonb_build_object(
    'success', TRUE,
    'data',    COALESCE(v_conversations, '[]'::jsonb)
  );
END;
$function$;

-- ─── 2. chat_assign_conversation ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_assign_conversation(
  p_conversation_id uuid,
  p_assigned_to     uuid,
  p_assigned_by     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id uuid;
  v_has_access boolean;
BEGIN
  -- Buscar company_id da conversa
  SELECT company_id INTO v_company_id
  FROM chat_conversations
  WHERE id = p_conversation_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Conversa não encontrada'
    );
  END IF;

  -- Trilha 1: membership direto
  SELECT EXISTS (
    SELECT 1 FROM company_users
    WHERE company_id = v_company_id
      AND user_id    = p_assigned_by
      AND is_active  = true
  ) INTO v_has_access;

  -- Trilha 2: super_admin / system_admin da empresa pai
  IF NOT v_has_access THEN
    SELECT public.auth_user_is_parent_admin(v_company_id) INTO v_has_access;
  END IF;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Acesso negado'
    );
  END IF;

  -- Atualizar atribuição
  UPDATE chat_conversations
  SET assigned_to = p_assigned_to,
      updated_at  = now()
  WHERE id = p_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Conversa atribuída com sucesso'
  );
END;
$function$;
