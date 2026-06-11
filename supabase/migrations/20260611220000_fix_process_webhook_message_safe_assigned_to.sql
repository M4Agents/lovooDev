-- =============================================================================
-- Migration: 20260611220000_fix_process_webhook_message_safe_assigned_to.sql
--
-- Objetivo:
--   Preencher chat_conversations.assigned_to automaticamente durante a criação
--   da conversa no fluxo WhatsApp, quando o lead já possui um responsável ativo.
--
-- Problema resolvido:
--   Conversas criadas por process_webhook_message_safe para leads com
--   responsible_user_id definido nasciam com assigned_to = NULL.
--   Isso causava divergência entre leads.responsible_user_id e
--   chat_conversations.assigned_to, afetando a visibilidade do chat
--   quando companies.chat_visibility_by_assigned_to = true.
--
-- Abordagem:
--   Opção A (aprovada na FASE 5O): preencher assigned_to diretamente no INSERT
--   da conversa, dentro da transação da função, usando v_lead_id já resolvido.
--
-- Objeto alterado:
--   public.process_webhook_message_safe(...) — CREATE OR REPLACE FUNCTION
--   Assinatura preservada (sem novos parâmetros, mesmo tipo de retorno).
--
-- Regras de negócio:
--   • assigned_to preenchido apenas no INSERT (nova conversa)
--   • UPDATE path (conversa existente) não toca assigned_to
--   • assigned_to = NULL quando: lead inexistente, sem responsável, ou inativo
--   • Validação de is_active = true em company_users
--   • Isolamento multi-tenant garantido via company_id
--
-- Rollback:
--   Reaplicar CREATE OR REPLACE FUNCTION com o corpo anterior.
--   Sem alteração de schema, sem dado migrado.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_webhook_message_safe(
  p_company_id                uuid,
  p_instance_id               uuid,
  p_phone_number              text,
  p_sender_name               text,
  p_content                   text,
  p_message_type              text,
  p_direction                 text,
  p_uazapi_message_id         text DEFAULT NULL::text,
  p_profile_picture_url       text DEFAULT NULL::text,
  p_media_url                 text DEFAULT NULL::text,
  p_reply_to_uazapi_message_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id          uuid;
  v_conversation_id     uuid;
  v_message_id          uuid;
  v_lead_id             INTEGER;
  v_responsible_user_id uuid;
  v_lead_created        BOOLEAN := false;
  v_reply_message_id    uuid    := NULL;
  v_phone_normalized    text;
  v_result              jsonb;
  v_current_photo_url   text;
  v_is_cdn_photo        boolean;
BEGIN
  RAISE LOG 'process_webhook_message_safe: Iniciando processamento para empresa % telefone %', p_company_id, p_phone_number;

  IF p_uazapi_message_id IS NOT NULL THEN
    SELECT cm.id, cc.id, cc.lead_id
    INTO v_message_id, v_conversation_id, v_lead_id
    FROM chat_messages cm
    JOIN chat_conversations cc ON cc.id = cm.conversation_id
    WHERE cm.uazapi_message_id = p_uazapi_message_id
      AND cm.company_id        = p_company_id
    LIMIT 1;

    IF v_message_id IS NOT NULL THEN
      RAISE LOG 'process_webhook_message_safe: Mensagem duplicata detectada (uazapi_message_id=%) — retornando existente %', p_uazapi_message_id, v_message_id;

      UPDATE chat_conversations
      SET last_message_at = NOW(), updated_at = NOW()
      WHERE id = v_conversation_id;

      RETURN jsonb_build_object(
        'success',         true,
        'message',         'Mensagem já registrada (deduplicada)',
        'contact_id',      NULL,
        'conversation_id', v_conversation_id,
        'message_id',      v_message_id,
        'lead_id',         v_lead_id,
        'lead_created',    false,
        'media_url',       p_media_url,
        'deduplicated',    true
      );
    END IF;
  END IF;

  IF p_reply_to_uazapi_message_id IS NOT NULL THEN
    SELECT id INTO v_reply_message_id
    FROM chat_messages
    WHERE uazapi_message_id = p_reply_to_uazapi_message_id
      AND company_id        = p_company_id
    LIMIT 1;
    RAISE LOG 'process_webhook_message_safe: reply_to resolvido: % → %', p_reply_to_uazapi_message_id, v_reply_message_id;
  END IF;

  SELECT id, profile_picture_url
  INTO v_contact_id, v_current_photo_url
  FROM chat_contacts
  WHERE phone_number = p_phone_number
    AND company_id   = p_company_id;

  IF v_contact_id IS NULL THEN
    INSERT INTO chat_contacts (
      company_id, phone_number, name, profile_picture_url,
      total_messages, tags, custom_fields, created_at, updated_at
    ) VALUES (
      p_company_id, p_phone_number, p_sender_name, p_profile_picture_url,
      0, '{}', '{}', NOW(), NOW()
    ) RETURNING id INTO v_contact_id;
    RAISE LOG 'process_webhook_message_safe: Contato criado com ID %', v_contact_id;
  ELSE
    v_is_cdn_photo := (
      v_current_photo_url IS NULL
      OR v_current_photo_url LIKE '%pps.whatsapp.net%'
      OR v_current_photo_url LIKE '%mmg.whatsapp.net%'
    );

    UPDATE chat_contacts
    SET
      name                = COALESCE(NULLIF(p_sender_name, ''), name),
      profile_picture_url = CASE
                              WHEN v_is_cdn_photo THEN COALESCE(p_profile_picture_url, profile_picture_url)
                              ELSE profile_picture_url
                            END,
      updated_at          = NOW()
    WHERE id = v_contact_id;
    RAISE LOG 'process_webhook_message_safe: Contato atualizado com ID % (photo_protected=%)', v_contact_id, (NOT v_is_cdn_photo);
  END IF;

  v_phone_normalized := REGEXP_REPLACE(p_phone_number, '[^0-9]', '', 'g');

  -- Resolver lead por telefone (inalterado)
  SELECT id INTO v_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND (
      REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = v_phone_normalized
      OR RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 11) = RIGHT(v_phone_normalized, 11)
    )
  LIMIT 1;

  RAISE LOG 'process_webhook_message_safe: Lead encontrado para telefone % → id=%', p_phone_number, COALESCE(v_lead_id::text, 'NULL');

  -- Resolver responsável ativo para preencher assigned_to na criação da conversa.
  -- Executa apenas quando lead existe. Retorna NULL se:
  --   • lead sem responsible_user_id
  --   • responsável inativo (is_active = false)
  -- Nunca impede a criação da conversa — v_responsible_user_id NULL é válido.
  IF v_lead_id IS NOT NULL THEN
    SELECT l.responsible_user_id INTO v_responsible_user_id
    FROM   leads l
    WHERE  l.id         = v_lead_id
      AND  l.deleted_at IS NULL
      AND  l.responsible_user_id IS NOT NULL
      AND  EXISTS (
             SELECT 1
             FROM   company_users cu
             WHERE  cu.user_id    = l.responsible_user_id
               AND  cu.company_id = l.company_id
               AND  cu.is_active  = true
           );
  END IF;

  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE company_id    = p_company_id
    AND instance_id   = p_instance_id
    AND contact_phone = p_phone_number;

  IF v_conversation_id IS NULL THEN
    INSERT INTO chat_conversations (
      company_id, instance_id, contact_phone, contact_name, lead_id,
      assigned_to,
      last_message_at, unread_count, status, created_at, updated_at
    ) VALUES (
      p_company_id, p_instance_id, p_phone_number, p_sender_name, v_lead_id,
      v_responsible_user_id,
      NOW(), CASE WHEN p_direction = 'inbound' THEN 1 ELSE 0 END,
      'active', NOW(), NOW()
    ) RETURNING id INTO v_conversation_id;
    RAISE LOG 'process_webhook_message_safe: Conversa criada com ID % lead_id % assigned_to %',
      v_conversation_id,
      COALESCE(v_lead_id::text, 'NULL'),
      COALESCE(v_responsible_user_id::text, 'NULL');
  ELSE
    UPDATE chat_conversations
    SET
      contact_name    = COALESCE(NULLIF(p_sender_name, ''), contact_name),
      lead_id         = COALESCE(lead_id, v_lead_id),
      last_message_at = NOW(),
      unread_count    = CASE
        WHEN p_direction = 'inbound' THEN unread_count + 1
        ELSE unread_count
      END,
      updated_at = NOW()
    WHERE id = v_conversation_id;
    RAISE LOG 'process_webhook_message_safe: Conversa atualizada com ID % e lead_id %', v_conversation_id, COALESCE(v_lead_id::text, 'NULL');
  END IF;

  INSERT INTO chat_messages (
    conversation_id, company_id, instance_id, message_type, content, media_url,
    direction, status, uazapi_message_id, reply_to_message_id, timestamp, created_at, updated_at
  ) VALUES (
    v_conversation_id, p_company_id, p_instance_id, p_message_type, p_content, p_media_url,
    p_direction, 'sent', p_uazapi_message_id, v_reply_message_id, NOW(), NOW(), NOW()
  ) RETURNING id INTO v_message_id;

  RAISE LOG 'process_webhook_message_safe: Mensagem criada com ID % reply_to=%', v_message_id, COALESCE(v_reply_message_id::text, 'NULL');

  v_result := jsonb_build_object(
    'success',         true,
    'message',         'Mensagem processada com sucesso via webhook seguro',
    'contact_id',      v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id,
    'lead_id',         v_lead_id,
    'lead_created',    v_lead_created,
    'media_url',       p_media_url
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'process_webhook_message_safe: ERRO - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error',   SQLERRM,
      'message', 'Erro ao processar mensagem via webhook seguro'
    );
END;
$$;
