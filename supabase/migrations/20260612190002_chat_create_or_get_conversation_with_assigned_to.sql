-- =============================================================================
-- FASE 5Z: chat_create_or_get_conversation — LEAD_ID + ASSIGNED_TO
-- =============================================================================
-- Arquivo: 20260612190002_chat_create_or_get_conversation_with_assigned_to.sql
-- Substitui: 20260430210000_fix_chat_create_or_get_conversation_instance_id.sql
--
-- Mudanças:
--   • Resolve lead por phone_normalized (coluna GENERATED STORED com índice)
--   • INSERT preenche lead_id e assigned_to
--   • UPDATE sincroniza assigned_to via v_lead_resolved
--   • NÃO usa auth.uid() em nenhum momento
--   • NÃO usa REGEXP_REPLACE(phone...) — usa coluna gerada phone_normalized
--
-- Índice utilizado na resolução do lead:
--   idx_leads_phone_normalized_company ON leads (phone_normalized, company_id)
--   Criado em: 20260402130000_add_phone_normalized_leads.sql
--   Tipo: B-tree, sargable para igualdade (phone_normalized = v_phone_normalized)
--
-- Regras de negócio:
--   Lead encontrado + responsável ativo   → assigned_to = responsible_user_id
--   Lead encontrado + sem responsável     → assigned_to = NULL
--   Lead não encontrado                   → não altera assigned_to
-- =============================================================================

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
  v_conversation_id     uuid;
  v_conversation        jsonb;
  v_instance_name       varchar;
  v_lead_id             INTEGER;           -- resolve lead pelo telefone
  v_responsible_user_id uuid;              -- responsible_user_id ativo do lead
  v_lead_resolved       BOOLEAN := false;  -- distingue "sem lead" de "lead sem responsável"
  v_phone_normalized    text;              -- dígitos normalizados para busca por índice
BEGIN
  -- Validar que instância existe e pertence à empresa
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

  -- ── Resolver lead por phone_normalized (índice idx_leads_phone_normalized_company)
  -- Normalizar apenas os dígitos do telefone recebido para comparar com a coluna gerada
  v_phone_normalized := REGEXP_REPLACE(p_contact_phone, '[^0-9]', '', 'g');

  SELECT id INTO v_lead_id
  FROM leads
  WHERE company_id     = p_company_id
    AND deleted_at     IS NULL
    AND (
      phone_normalized = v_phone_normalized                             -- match exato (usa índice)
      OR RIGHT(phone_normalized, 11) = RIGHT(v_phone_normalized, 11)   -- fallback 11 dígitos
    )
  LIMIT 1;

  IF v_lead_id IS NOT NULL THEN
    v_lead_resolved := true;  -- lead foi identificado

    -- Resolver responsável ativo do lead
    -- Retorna NULL quando: sem responsible_user_id ou responsável inativo
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

  -- Buscar conversa ativa existente pelo telefone (qualquer instância)
  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE company_id    = p_company_id
    AND contact_phone = p_contact_phone
    AND status        = 'active'
  ORDER BY instance_id NULLS LAST
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    -- Nova conversa: preencher lead_id e assigned_to
    INSERT INTO chat_conversations (
      company_id,
      instance_id,
      contact_phone,
      contact_name,
      lead_id,                  -- preenchido quando lead resolvido por telefone
      assigned_to,              -- NULL quando sem responsável ativo (correto por design)
      last_instance_id,
      last_instance_name
    ) VALUES (
      p_company_id,
      p_instance_id,
      p_contact_phone,
      p_contact_name,
      v_lead_id,                -- UUID do lead ou NULL
      v_responsible_user_id,    -- UUID do responsável ou NULL
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
    -- Conversa existente: atualizar instância + sincronizar lead_id e assigned_to
    UPDATE chat_conversations
    SET last_instance_id   = p_instance_id,
        last_instance_name = v_instance_name,
        -- Preencher lead_id se ainda NULL (nova associação após criação da conversa)
        lead_id            = COALESCE(lead_id, v_lead_id),
        -- Sincronizar assigned_to ao CRM quando lead foi resolvido e há divergência
        -- v_lead_resolved = false → ELSE: não altera (lead não identificado pelo telefone)
        -- v_lead_resolved = true, UUID  → THEN: alinha ao responsável do CRM
        -- v_lead_resolved = true, NULL  → THEN: limpa (responsável removido ou inativo)
        assigned_to        = CASE
                               WHEN v_lead_resolved
                                AND assigned_to IS DISTINCT FROM v_responsible_user_id
                               THEN v_responsible_user_id
                               ELSE assigned_to
                             END,
        updated_at         = NOW()
    WHERE id = v_conversation_id;
  END IF;

  -- Retornar dados completos da conversa
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
