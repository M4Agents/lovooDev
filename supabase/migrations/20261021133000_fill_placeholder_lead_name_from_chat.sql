-- Quando um nome real chega no chat, grava no lead se o nome atual ainda for
-- provisório. Não substitui um nome real já cadastrado.
-- Também preenche os leads que já têm um único nome real no chat e esse nome
-- não é o da instância de WhatsApp.

CREATE OR REPLACE FUNCTION public.lead_name_is_placeholder(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT
    p_name IS NULL
    OR btrim(p_name) = ''
    OR btrim(p_name) IN ('.', 'Lead WhatsApp')
    OR btrim(p_name) ~ '^Contato [0-9]+$'
    OR btrim(p_name) ~ '^[0-9]+$';
$$;

CREATE OR REPLACE FUNCTION public.lead_name_is_real(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT
    NOT public.lead_name_is_placeholder(p_name)
    AND btrim(p_name) ~ '[[:alpha:]]';
$$;

COMMENT ON FUNCTION public.lead_name_is_placeholder(text) IS
  'Nome provisório de lead ou chat: vazio, ponto, Lead WhatsApp, Contato + número ou só dígitos.';

COMMENT ON FUNCTION public.lead_name_is_real(text) IS
  'Nome com letra que não é provisório. É o único tipo copiado do chat para o lead.';

REVOKE ALL ON FUNCTION public.lead_name_is_placeholder(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lead_name_is_real(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lead_name_is_placeholder(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lead_name_is_real(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.process_webhook_message_safe(
  p_company_id uuid,
  p_instance_id uuid,
  p_phone_number text,
  p_sender_name text,
  p_content text,
  p_message_type text,
  p_direction text,
  p_uazapi_message_id text DEFAULT NULL::text,
  p_profile_picture_url text DEFAULT NULL::text,
  p_media_url text DEFAULT NULL::text,
  p_reply_to_uazapi_message_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_contact_id          uuid;
  v_conversation_id     uuid;
  v_message_id          uuid;
  v_lead_id             INTEGER;
  v_responsible_user_id uuid;
  v_lead_resolved       BOOLEAN := false;
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
  END IF;

  v_phone_normalized := public.canonicalize_br_mobile_phone(p_phone_number);

  SELECT id INTO v_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND (
      phone_normalized = v_phone_normalized
      OR public.canonicalize_br_mobile_phone(phone) = v_phone_normalized
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
             SELECT 1
             FROM   company_users cu
             WHERE  cu.user_id    = l.responsible_user_id
               AND  cu.company_id = l.company_id
               AND  cu.is_active  = true
           );

    IF public.lead_name_is_real(p_sender_name) THEN
      UPDATE leads
      SET name = btrim(p_sender_name)
      WHERE id = v_lead_id
        AND company_id = p_company_id
        AND deleted_at IS NULL
        AND public.lead_name_is_placeholder(name);
    END IF;
  END IF;

  SELECT id INTO v_conversation_id
  FROM chat_conversations
  WHERE company_id  = p_company_id
    AND instance_id = p_instance_id
    AND (
      contact_phone = p_phone_number
      OR public.canonicalize_br_mobile_phone(contact_phone) = v_phone_normalized
    )
  ORDER BY
    CASE WHEN contact_phone = p_phone_number THEN 0 ELSE 1 END
  LIMIT 1;

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
  ELSE
    UPDATE chat_conversations
    SET
      contact_name    = COALESCE(NULLIF(p_sender_name, ''), contact_name),
      lead_id         = COALESCE(lead_id, v_lead_id),
      assigned_to     = CASE
                          WHEN v_lead_resolved
                           AND assigned_to IS DISTINCT FROM v_responsible_user_id
                          THEN v_responsible_user_id
                          ELSE assigned_to
                        END,
      last_message_at = NOW(),
      unread_count    = CASE
        WHEN p_direction = 'inbound' THEN unread_count + 1
        ELSE unread_count
      END,
      updated_at      = NOW()
    WHERE id = v_conversation_id;
  END IF;

  INSERT INTO chat_messages (
    conversation_id, company_id, instance_id, message_type, content, media_url,
    direction, status, uazapi_message_id, reply_to_message_id, timestamp, created_at, updated_at
  ) VALUES (
    v_conversation_id, p_company_id, p_instance_id, p_message_type, p_content, p_media_url,
    p_direction, 'sent', p_uazapi_message_id, v_reply_message_id, NOW(), NOW(), NOW()
  ) RETURNING id INTO v_message_id;

  RETURN jsonb_build_object(
    'success',         true,
    'message',         'Mensagem processada com sucesso via webhook seguro',
    'contact_id',      v_contact_id,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id,
    'lead_id',         v_lead_id,
    'lead_created',    v_lead_created,
    'media_url',       p_media_url
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'process_webhook_message_safe: ERRO - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error',   SQLERRM,
      'message', 'Erro ao processar mensagem via webhook seguro'
    );
END;
$function$;

CREATE OR REPLACE VIEW public.chat_conversations_with_leads AS
SELECT
    cc.id,
    cc.company_id,
    COALESCE(cc.instance_id, cc.last_instance_id) AS instance_id,
    cc.contact_phone,
    COALESCE(
        CASE WHEN public.lead_name_is_real(l.name) THEN l.name ELSE NULL END,
        CASE WHEN public.lead_name_is_real(ctc.name::text) THEN ctc.name::text ELSE NULL END,
        CASE WHEN public.lead_name_is_real(cc.contact_name::text) THEN cc.contact_name::text ELSE NULL END,
        NULLIF(btrim(cc.contact_name::text), ''),
        NULLIF(btrim(l.name), '')
    ) AS contact_name,
    ctc.profile_picture_url,
    cc.assigned_to,
    cc.last_message_at,
    cc.last_message_content,
    cc.last_message_direction,
    cc.unread_count,
    cc.status,
    cc.created_at,
    cc.updated_at,
    l.id AS lead_id,
    l.name AS lead_name,
    ctc.name AS chat_contact_name,
    cc.contact_name AS original_contact_name,
    l.company_name
FROM chat_conversations cc
LEFT JOIN LATERAL (
    SELECT
        picked.id,
        picked.name,
        picked.company_name
    FROM leads picked
    WHERE picked.company_id = cc.company_id
      AND picked.deleted_at IS NULL
      AND (
        (
          picked.id = cc.lead_id
          AND (
            NULLIF(btrim(picked.phone), '') IS NULL
            OR public.canonicalize_br_mobile_phone(picked.phone)
               IS NOT DISTINCT FROM public.canonicalize_br_mobile_phone(cc.contact_phone)
          )
        )
        OR picked.phone_normalized = ANY (public.br_mobile_phone_lookup_values(cc.contact_phone))
      )
    ORDER BY
      CASE
        WHEN picked.id = cc.lead_id
         AND (
           NULLIF(btrim(picked.phone), '') IS NULL
           OR public.canonicalize_br_mobile_phone(picked.phone)
              IS NOT DISTINCT FROM public.canonicalize_br_mobile_phone(cc.contact_phone)
         )
        THEN 0
        ELSE 1
      END,
      picked.created_at ASC,
      picked.id ASC
    LIMIT 1
) l ON true
LEFT JOIN chat_contacts ctc
    ON ctc.company_id = cc.company_id
   AND ctc.phone_number::text = cc.contact_phone::text;

WITH leads_ph AS (
  SELECT l.id, l.company_id, public.canonicalize_br_mobile_phone(l.phone) AS canon
  FROM leads l
  WHERE l.deleted_at IS NULL
    AND l.phone IS NOT NULL
    AND public.lead_name_is_placeholder(l.name)
),
chat_names AS (
  SELECT company_id, public.canonicalize_br_mobile_phone(phone_number) AS canon, btrim(name) AS name
  FROM chat_contacts
  WHERE public.lead_name_is_real(name)
  UNION
  SELECT company_id, public.canonicalize_br_mobile_phone(contact_phone), btrim(contact_name)
  FROM chat_conversations
  WHERE public.lead_name_is_real(contact_name)
),
one_name AS (
  SELECT l.id, l.company_id, min(c.name) AS nome
  FROM leads_ph l
  JOIN chat_names c
    ON c.company_id = l.company_id
   AND c.canon = l.canon
   AND c.canon IS NOT NULL
  GROUP BY l.id, l.company_id
  HAVING count(DISTINCT c.name) = 1
)
UPDATE leads AS target
SET name = chosen.nome
FROM one_name AS chosen
WHERE target.id = chosen.id
  AND target.company_id = chosen.company_id
  AND target.deleted_at IS NULL
  AND public.lead_name_is_placeholder(target.name)
  AND public.lead_name_is_real(chosen.nome)
  AND NOT EXISTS (
    SELECT 1
    FROM whatsapp_life_instances AS instance
    WHERE instance.company_id = chosen.company_id
      AND lower(btrim(chosen.nome)) IN (
        lower(btrim(instance.profile_name)),
        lower(btrim(instance.instance_name))
      )
  );
