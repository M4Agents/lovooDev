-- =============================================================================
-- Migration: adicionar ai_state e ai_assignment_id ao retorno de chat_get_conversations
--
-- A RPC buscava dados apenas da view chat_conversations_with_leads, que não expõe
-- campos de IA adicionados pela Etapa 1 do MVP de agentes. Este patch adiciona
-- um LEFT JOIN na tabela chat_conversations para expor esses campos ao frontend.
-- Todas as demais regras de validação e filtragem permanecem idênticas.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_get_conversations(
  p_company_id uuid,
  p_user_id uuid,
  p_filter_type character varying,
  p_instance_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conversations jsonb;
BEGIN
  -- Validar acesso à empresa: aceita o dono OU membros ativos via company_users
  IF NOT EXISTS (
    SELECT 1 FROM companies
    WHERE id = p_company_id AND user_id = p_user_id
    UNION
    SELECT 1 FROM company_users
    WHERE company_id = p_company_id AND user_id = p_user_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Acesso negado à empresa'
    );
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', ccl.id,
      'company_id', ccl.company_id,
      'instance_id', ccl.instance_id,
      'contact_phone', ccl.contact_phone,
      'contact_name', ccl.contact_name,
      'lead_id', ccl.lead_id,
      'profile_picture_url', ccl.profile_picture_url,
      'company_name', ccl.company_name,
      -- Campos de IA: vindos de chat_conversations via LEFT JOIN
      'ai_state', cc.ai_state,
      'ai_assignment_id', cc.ai_assignment_id,
      'assigned_to', CASE
        WHEN ccl.assigned_to IS NOT NULL THEN
          jsonb_build_object(
            'id', ccl.assigned_to,
            'email', au.email
          )
        ELSE NULL
      END,
      'last_message_at', ccl.last_message_at,
      'last_message_content', ccl.last_message_content,
      'last_message_direction', ccl.last_message_direction,
      'unread_count', ccl.unread_count,
      'status', ccl.status,
      'instance_name', COALESCE(wli.instance_name, 'Instância Desconectada'),
      'instance_status', COALESCE(wli.status, 'disconnected'),
      'instance_deleted', CASE WHEN wli.deleted_at IS NOT NULL THEN true ELSE false END,
      'created_at', ccl.created_at,
      'updated_at', ccl.updated_at
    ) ORDER BY ccl.last_message_at DESC NULLS LAST
  ) INTO v_conversations
  FROM chat_conversations_with_leads ccl
  LEFT JOIN auth.users au ON ccl.assigned_to = au.id
  LEFT JOIN whatsapp_life_instances wli ON ccl.instance_id = wli.id
  LEFT JOIN chat_conversations cc ON cc.id = ccl.id
  WHERE ccl.company_id = p_company_id
    AND (
      p_instance_id IS NULL OR
      ccl.instance_id = p_instance_id OR
      (ccl.instance_id IS NULL AND p_instance_id IS NULL)
    )
    AND CASE
      WHEN p_filter_type = 'assigned' THEN ccl.assigned_to = p_user_id
      WHEN p_filter_type = 'unassigned' THEN ccl.assigned_to IS NULL
      ELSE TRUE
    END
    AND ccl.status = 'active'
  LIMIT p_limit OFFSET p_offset;

  RETURN jsonb_build_object(
    'success', TRUE,
    'data', COALESCE(v_conversations, '[]'::jsonb)
  );
END;
$function$;
