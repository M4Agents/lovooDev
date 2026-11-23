-- =============================================================================
-- ROLLBACK — NÃO EXECUTAR SEM AUTORIZAÇÃO EXPLÍCITA
-- Reverte somente as funções criadas ou substituídas por
-- supabase/migrations/20261123210100_resolve_meta_conversation_lead.sql
-- Não altera public.link_meta_conversation_lead.
-- Não altera private.link_meta_conversation_lead.
-- Não altera public.create_lead_from_whatsapp_safe.
-- Definições capturadas no banco postgres do projeto oficial antes da aplicação.
-- MD5 process_meta_inbound_message: 16acead6d399ee1214c737cb07d8b549
-- MD5 process_meta_inbound_media_message: 296b5148567b222b2a74dbc580c94c14
-- Dono: postgres. search_path=public. SECURITY DEFINER.
-- ACL anterior: postgres=X/postgres, service_role=X/postgres.
-- anon e authenticated sem EXECUTE.
-- A ordem restaura os corpos antigos e só depois remove as funções novas.
-- O registro em schema_migrations não é apagado por este arquivo.
-- =============================================================================

BEGIN;
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.process_meta_inbound_message(p_company_id uuid, p_instance_id uuid, p_wa_id text, p_meta_message_id text, p_body text, p_contact_name text DEFAULT NULL::text, p_provider_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conversation_id UUID;
  v_message_id      UUID;
BEGIN

  -- ── 0. Barreira: apenas service_role pode chamar esta função ─────────────────────
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 1. Validar parâmetros obrigatórios ────────────────────────────────────
  IF p_wa_id IS NULL OR trim(p_wa_id) = '' THEN
    RAISE EXCEPTION 'p_wa_id é obrigatório e não pode ser vazio'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_meta_message_id IS NULL OR trim(p_meta_message_id) = '' THEN
    RAISE EXCEPTION 'p_meta_message_id é obrigatório e não pode ser vazio'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_body IS NULL OR trim(p_body) = '' THEN
    RAISE EXCEPTION 'p_body é obrigatório para message_type=text'
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── 2. Validar instância Meta ────────────────────────────────────────
  IF NOT EXISTS (
    SELECT 1
      FROM public.meta_whatsapp_instances
     WHERE company_id = p_company_id
       AND id         = p_instance_id
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Instância Meta não encontrada ou removida: company_id=%, instance_id=%',
      p_company_id, p_instance_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 3. Idempotência: verificação antecipada de wamid duplicado ───────────────
  SELECT mm.conversation_id,
         mm.id
    INTO v_conversation_id,
         v_message_id
    FROM public.meta_messages mm
   WHERE mm.instance_id     = p_instance_id
     AND mm.meta_message_id = p_meta_message_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'created',         false,
      'conversation_id', v_conversation_id,
      'message_id',      v_message_id
    );
  END IF;

  -- ── 4. Criar ou localizar a conversa ────────────────────────────────────
  INSERT INTO public.meta_conversations (
    company_id,
    instance_id,
    wa_id,
    contact_name,
    status,
    unread_count,
    last_message_at,
    last_message_preview,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    p_instance_id,
    p_wa_id,
    p_contact_name,
    'active',
    0,
    NULL,
    NULL,
    now(),
    now()
  )
  ON CONFLICT (company_id, instance_id, wa_id) DO UPDATE SET
    contact_name = COALESCE(EXCLUDED.contact_name, meta_conversations.contact_name)
  RETURNING id INTO v_conversation_id;

  -- ── 5. Inserir mensagem ───────────────────────────────────────────────────
  INSERT INTO public.meta_messages (
    company_id,
    conversation_id,
    instance_id,
    meta_message_id,
    direction,
    message_type,
    body,
    provider_timestamp,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    v_conversation_id,
    p_instance_id,
    p_meta_message_id,
    'inbound',
    'text',
    p_body,
    p_provider_timestamp,
    now(),
    now()
  )
  ON CONFLICT (instance_id, meta_message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  -- ── 5b. Race condition: recuperar IDs reais da mensagem vencedora ────────────
  IF v_message_id IS NULL THEN
    SELECT mm.id,
           mm.conversation_id
      INTO v_message_id,
           v_conversation_id
      FROM public.meta_messages mm
     WHERE mm.instance_id     = p_instance_id
       AND mm.meta_message_id = p_meta_message_id;

    RETURN jsonb_build_object(
      'created',         false,
      'conversation_id', v_conversation_id,
      'message_id',      v_message_id
    );
  END IF;

  -- ── 6. Atualizar estatísticas da conversa ───────────────────────────────────
  UPDATE public.meta_conversations SET
    unread_count         = unread_count + 1,

    last_message_at      = CASE
                             WHEN p_provider_timestamp IS NOT NULL
                                  AND (last_message_at IS NULL
                                       OR p_provider_timestamp >= last_message_at)
                               THEN p_provider_timestamp
                             WHEN p_provider_timestamp IS NULL
                                  AND last_message_at IS NULL
                               THEN now()
                             ELSE last_message_at
                           END,

    last_message_preview = CASE
                             WHEN p_provider_timestamp IS NOT NULL
                                  AND (last_message_at IS NULL
                                       OR p_provider_timestamp >= last_message_at)
                               THEN LEFT(p_body, 100)
                             WHEN p_provider_timestamp IS NULL
                                  AND last_message_at IS NULL
                               THEN LEFT(p_body, 100)
                             ELSE last_message_preview
                           END,

    contact_name         = COALESCE(p_contact_name, contact_name)
  WHERE id = v_conversation_id;

  -- ── 7. Retorno ──────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'created',         true,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id
  );

END;
$function$

CREATE OR REPLACE FUNCTION public.process_meta_inbound_media_message(p_company_id uuid, p_instance_id uuid, p_wa_id text, p_meta_message_id text, p_media_asset_id uuid, p_contact_name text DEFAULT NULL::text, p_provider_timestamp timestamp with time zone DEFAULT NULL::timestamp with time zone, p_message_type text DEFAULT 'document'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conversation_id UUID;
  v_message_id      UUID;
  v_asset_file_type TEXT;
  v_preview         TEXT;
BEGIN

  -- 0. Barreira: apenas service_role pode chamar esta função
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. Validar parâmetros obrigatórios
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'p_company_id é obrigatório'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'p_instance_id é obrigatório'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_media_asset_id IS NULL THEN
    RAISE EXCEPTION 'p_media_asset_id é obrigatório'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_wa_id IS NULL OR trim(p_wa_id) = '' THEN
    RAISE EXCEPTION 'p_wa_id é obrigatório e não pode ser vazio'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_meta_message_id IS NULL OR trim(p_meta_message_id) = '' THEN
    RAISE EXCEPTION 'p_meta_message_id é obrigatório e não pode ser vazio'
      USING ERRCODE = 'check_violation';
  END IF;

  -- p_message_type deve ser estritamente um tipo de mídia suportado.
  -- 'text' e 'template' são intencionalmente excluídos (use process_meta_inbound_message).
  -- 'sticker', 'interactive' e outros continuam rejeitados.
  IF p_message_type NOT IN ('document', 'image', 'video', 'audio') THEN
    RAISE EXCEPTION
      'p_message_type inválido: %. Permitido: document, image, video, audio',
      p_message_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2. Validar instância Meta
  IF NOT EXISTS (
    SELECT 1
      FROM public.meta_whatsapp_instances
     WHERE company_id = p_company_id
       AND id         = p_instance_id
       AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Instância Meta não encontrada ou removida: company_id=%, instance_id=%',
      p_company_id, p_instance_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 3. Validar media asset (defense-in-depth além da FK composta)
  -- Garante que o asset existe, pertence a esta empresa e tem file_type
  -- compatível com p_message_type antes de qualquer escrita.
  -- Para audio: file_type do CML deve ser exatamente 'audio'.
  SELECT file_type
    INTO v_asset_file_type
    FROM public.company_media_library
   WHERE id         = p_media_asset_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Media asset não encontrado ou pertence a outra empresa: asset_id=%, company_id=%',
      p_media_asset_id, p_company_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_asset_file_type <> p_message_type THEN
    RAISE EXCEPTION
      'file_type do asset (%) diverge do message_type esperado (%): asset_id=%',
      v_asset_file_type, p_message_type, p_media_asset_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 4. Idempotência: verificação antecipada de wamid duplicado
  SELECT mm.conversation_id,
         mm.id
    INTO v_conversation_id,
         v_message_id
    FROM public.meta_messages mm
   WHERE mm.instance_id     = p_instance_id
     AND mm.meta_message_id = p_meta_message_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'created',         false,
      'conversation_id', v_conversation_id,
      'message_id',      v_message_id
    );
  END IF;

  -- 5. Criar ou localizar a conversa
  INSERT INTO public.meta_conversations (
    company_id,
    instance_id,
    wa_id,
    contact_name,
    status,
    unread_count,
    last_message_at,
    last_message_preview,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    p_instance_id,
    p_wa_id,
    p_contact_name,
    'active',
    0,
    NULL,
    NULL,
    now(),
    now()
  )
  ON CONFLICT (company_id, instance_id, wa_id) DO UPDATE SET
    contact_name = COALESCE(EXCLUDED.contact_name, meta_conversations.contact_name)
  RETURNING id INTO v_conversation_id;

  -- 6. Inserir mensagem de mídia
  INSERT INTO public.meta_messages (
    company_id,
    conversation_id,
    instance_id,
    meta_message_id,
    direction,
    message_type,
    body,
    media_asset_id,
    provider_timestamp,
    created_at,
    updated_at
  )
  VALUES (
    p_company_id,
    v_conversation_id,
    p_instance_id,
    p_meta_message_id,
    'inbound',
    p_message_type,
    NULL,
    p_media_asset_id,
    p_provider_timestamp,
    now(),
    now()
  )
  ON CONFLICT (instance_id, meta_message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  -- 6b. Race condition: recuperar IDs reais da mensagem vencedora
  IF v_message_id IS NULL THEN
    SELECT mm.id,
           mm.conversation_id
      INTO v_message_id,
           v_conversation_id
      FROM public.meta_messages mm
     WHERE mm.instance_id     = p_instance_id
       AND mm.meta_message_id = p_meta_message_id;

    RETURN jsonb_build_object(
      'created',         false,
      'conversation_id', v_conversation_id,
      'message_id',      v_message_id
    );
  END IF;

  -- 7. Preview determinístico por tipo de mídia
  v_preview := CASE p_message_type
    WHEN 'document' THEN 'Documento'
    WHEN 'image'    THEN 'Imagem'
    WHEN 'video'    THEN 'Vídeo'
    WHEN 'audio'    THEN 'Áudio'
    ELSE                 'Mídia'
  END;

  -- 8. Atualizar estatísticas da conversa
  UPDATE public.meta_conversations SET
    unread_count         = unread_count + 1,

    last_message_at      = CASE
                             WHEN p_provider_timestamp IS NOT NULL
                                  AND (last_message_at IS NULL
                                       OR p_provider_timestamp >= last_message_at)
                               THEN p_provider_timestamp
                             WHEN p_provider_timestamp IS NULL
                                  AND last_message_at IS NULL
                               THEN now()
                             ELSE last_message_at
                           END,

    last_message_preview = CASE
                             WHEN p_provider_timestamp IS NOT NULL
                                  AND (last_message_at IS NULL
                                       OR p_provider_timestamp >= last_message_at)
                               THEN v_preview
                             WHEN p_provider_timestamp IS NULL
                                  AND last_message_at IS NULL
                               THEN v_preview
                             ELSE last_message_preview
                           END,

    contact_name         = COALESCE(p_contact_name, contact_name)
  WHERE id = v_conversation_id;

  -- 9. Retorno
  RETURN jsonb_build_object(
    'created',         true,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id
  );

END;
$function$

REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  uuid, uuid, text, text, text, text, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  uuid, uuid, text, text, text, text, timestamptz
) FROM anon;
REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  uuid, uuid, text, text, text, text, timestamptz
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_meta_inbound_message(
  uuid, uuid, text, text, text, text, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION public.process_meta_inbound_media_message(
  uuid, uuid, text, text, uuid, text, timestamptz, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_meta_inbound_media_message(
  uuid, uuid, text, text, uuid, text, timestamptz, text
) FROM anon;
REVOKE ALL ON FUNCTION public.process_meta_inbound_media_message(
  uuid, uuid, text, text, uuid, text, timestamptz, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_meta_inbound_media_message(
  uuid, uuid, text, text, uuid, text, timestamptz, text
) TO service_role;

DROP FUNCTION IF EXISTS public.acquire_meta_lead_phone_locks(uuid, text);
DROP FUNCTION IF EXISTS public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS private.create_and_link_meta_conversation_lead(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer);

COMMIT;
