-- =============================================================================
-- Migration: fix_chat_create_or_get_conversation_order
-- Data: 2026-07-13
--
-- Problema: a função buscava conversas ativas ordenando por `instance_id NULLS LAST`,
-- o que resulta em ordem alfabética por UUID — essencialmente aleatória.
-- Quando um lead tem múltiplas conversas ativas (ex: "Maria" desconectada e
-- "IC Campo Limpo" conectada), a função podia retornar a conversa errada,
-- causando falha no envio de mensagens via automação e ChatModal.
--
-- Correção: o ORDER BY agora prioriza a conversa vinculada à instância
-- solicitada (p_instance_id), mantendo o fallback para outras conversas ativas.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.chat_create_or_get_conversation(
  p_company_id    uuid,
  p_instance_id   uuid,
  p_contact_phone character varying,
  p_contact_name  character varying DEFAULT NULL::character varying
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_conversation_id     uuid;
  v_conversation        jsonb;
  v_instance_name       varchar;
  v_lead_id             INTEGER;
  v_responsible_user_id uuid;
  v_lead_resolved       BOOLEAN := false;
  v_phone_normalized    text;
BEGIN
  SELECT instance_name INTO v_instance_name
  FROM whatsapp_life_instances
  WHERE id         = p_instance_id
    AND company_id = p_company_id;

  IF v_instance_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Instância não encontrada ou não pertence à empresa'
    );
  END IF;

  v_phone_normalized := REGEXP_REPLACE(p_contact_phone, '[^0-9]', '', 'g');

  SELECT id INTO v_lead_id
  FROM leads
  WHERE company_id     = p_company_id
    AND deleted_at     IS NULL
    AND (
      phone_normalized = v_phone_normalized
      OR RIGHT(phone_normalized, 11) = RIGHT(v_phone_normalized, 11)
    )
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    v_lead_resolved := true;

    SELECT l.responsible_user_id INTO v_responsible_user_id
    FROM   leads l
    WHERE  l.id         = v_lead_id
      AND  l.deleted_at IS NULL
      AND  l.responsible_user_id IS NOT NULL
      AND  EXISTS (
             SELECT 1 FROM company_users cu
             WHERE  cu.user_id    = l.responsible_user_id
               AND  cu.company_id = l.company_id
               AND  cu.is_active  = true
           );
  END IF;

  -- Busca conversa ativa existente priorizando a que já está vinculada
  -- à instância solicitada, evitando retornar conversas de instâncias
  -- desconectadas ou deletadas quando existe uma conversa na instância certa.
  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE company_id    = p_company_id
    AND contact_phone = p_contact_phone
    AND status        = 'active'
  ORDER BY
    CASE WHEN instance_id = p_instance_id THEN 0 ELSE 1 END,
    instance_id NULLS LAST
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id,
      instance_id,
      contact_phone,
      contact_name,
      lead_id,
      assigned_to,
      last_instance_id,
      last_instance_name
    ) VALUES (
      p_company_id,
      p_instance_id,
      p_contact_phone,
      p_contact_name,
      v_lead_id,
      v_responsible_user_id,
      p_instance_id,
      v_instance_name
    )
    RETURNING id INTO v_conversation_id;

    INSERT INTO chat_contacts (
      company_id,
      phone_number,
      name,
      first_contact_at,
      last_activity_at
    ) VALUES (
      p_company_id,
      p_contact_phone,
      p_contact_name,
      now(),
      now()
    )
    ON CONFLICT (company_id, phone_number)
    DO UPDATE SET
      name             = COALESCE(EXCLUDED.name, chat_contacts.name),
      last_activity_at = now();
  ELSE
    UPDATE chat_conversations
    SET last_instance_id   = p_instance_id,
        last_instance_name = v_instance_name,
        lead_id            = COALESCE(lead_id, v_lead_id),
        assigned_to        = CASE
                               WHEN v_lead_resolved
                                AND assigned_to IS DISTINCT FROM v_responsible_user_id
                               THEN v_responsible_user_id
                               ELSE assigned_to
                             END,
        updated_at         = NOW()
    WHERE id = v_conversation_id;
  END IF;

  SELECT jsonb_build_object(
    'id',                     cc.id,
    'company_id',             cc.company_id,
    'instance_id',            cc.instance_id,
    'contact_phone',          cc.contact_phone,
    'contact_name',           cc.contact_name,
    'assigned_to',            cc.assigned_to,
    'last_message_at',        cc.last_message_at,
    'last_message_content',   cc.last_message_content,
    'last_message_direction', cc.last_message_direction,
    'unread_count',           cc.unread_count,
    'status',                 cc.status,
    'created_at',             cc.created_at,
    'updated_at',             cc.updated_at
  ) INTO v_conversation
  FROM chat_conversations cc
  WHERE cc.id = v_conversation_id;

  RETURN jsonb_build_object(
    'success', true,
    'data',    v_conversation
  );
END;
$function$;
