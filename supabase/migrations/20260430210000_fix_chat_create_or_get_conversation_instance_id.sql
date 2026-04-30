-- =====================================================================
-- Fix: chat_create_or_get_conversation — vincular instance_id ao criar conversa
--
-- Problema: a função criava conversas com instance_id = NULL (design "desvinculado").
-- Isso causava conflito com process_webhook_message_safe, que busca conversas por
-- instance_id específico. Resultado: dois caminhos criavam conversas paralelas
-- para o mesmo telefone — uma da automação (instance_id=NULL) e outra do webhook
-- (instance_id preenchido). O /resetar e as respostas do lead iam para a conversa
-- errada, e o agente nunca via as mensagens recebidas.
--
-- Solução: armazenar instance_id = p_instance_id ao criar novas conversas.
-- Backward compatible: conversas existentes não são afetadas. A busca por
-- telefone (sem filtro de instância) continua para reutilizar conversas ativas.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.chat_create_or_get_conversation(
  p_company_id    uuid,
  p_instance_id   uuid,
  p_contact_phone character varying,
  p_contact_name  character varying DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_conversation_id uuid;
  v_conversation    jsonb;
  v_instance_name   varchar;
BEGIN
  -- Validar que instância existe e pertence à empresa
  SELECT instance_name INTO v_instance_name
  FROM whatsapp_life_instances
  WHERE id = p_instance_id
    AND company_id = p_company_id;

  IF v_instance_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Instância não encontrada ou não pertence à empresa'
    );
  END IF;

  -- Buscar conversa ativa existente pelo telefone (qualquer instância).
  -- ORDER BY instance_id NULLS LAST garante preferência por conversas com instância definida.
  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE company_id    = p_company_id
    AND contact_phone = p_contact_phone
    AND status        = 'active'
  ORDER BY instance_id NULLS LAST
  LIMIT 1;

  -- Se não existe, criar nova vinculada à instância (instance_id preenchido)
  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id,
      instance_id,
      contact_phone,
      contact_name,
      last_instance_id,
      last_instance_name
    ) VALUES (
      p_company_id,
      p_instance_id,       -- ✅ Vinculado à instância (era NULL antes)
      p_contact_phone,
      p_contact_name,
      p_instance_id,
      v_instance_name
    )
    RETURNING id INTO v_conversation_id;

    -- Criar ou atualizar contato
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
    -- Atualizar última instância usada
    UPDATE chat_conversations
    SET last_instance_id   = p_instance_id,
        last_instance_name = v_instance_name,
        updated_at         = NOW()
    WHERE id = v_conversation_id;
  END IF;

  -- Buscar dados completos da conversa
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
$$;
