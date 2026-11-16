-- =============================================================================
-- ROLLBACK MANUAL — NÃO APLICAR
-- Alvo: supabase/migrations/20261116140000_allow_audio_in_meta_inbound_media.sql
--
-- Este arquivo NÃO faz parte da sequência automática de migrations.
-- NÃO executar sem autorização explícita.
-- NÃO executar DELETE, TRUNCATE, DROP CASCADE ou DROP FUNCTION.
-- NÃO apagar mensagens audio nem assets de company_media_library.
--
-- Política:
--   1. Se existirem linhas public.meta_messages.message_type = 'audio',
--      ABORTAR. A reversão do CHECK falharia ou exigiria perda de dados.
--      Opção preferencial nesse cenário:
--        - corrigir a aplicação para frente (manter CHECK ampliado + RPC com audio)
--        - ou manter o CHECK com 'audio' mesmo se o webhook voltar a skippar audio
--   2. Somente se NÃO houver linhas audio: restaurar o CHECK anterior
--      (text, template, document, image, video) e o corpo da RPC de
--      20260924112100_create_process_meta_inbound_media_message.sql.
--   3. Grants, SECURITY DEFINER, search_path e validações multi-tenant
--      permanecem os de 20260924112100.
--
-- Pré-condição operacional recomendada (fora deste arquivo):
--   backend/webhook já não deve gravar message_type='audio'.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Guarda: existência de audio impede qualquer reversão de CHECK/RPC.
-- Sem DELETE. Sem UPDATE de message_type. A transação aborta inteira.
-- ---------------------------------------------------------------------------
DO $guard$
DECLARE
  v_audio_count integer;
BEGIN
  SELECT count(*)
    INTO v_audio_count
    FROM public.meta_messages
   WHERE message_type = 'audio';

  IF v_audio_count > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK_ABORT: % linha(s) em public.meta_messages com message_type=audio. '
      'Não reverter CHECK nem a RPC. Não há reversão sem perda de dados. '
      'Preferir correção para frente ou manter o CHECK ampliado.',
      v_audio_count
      USING ERRCODE = 'raise_exception';
  END IF;
END
$guard$;


-- ---------------------------------------------------------------------------
-- Restaurar CHECK anterior (20260924111200) — só alcançado se audio_count = 0.
-- NOT VALID + VALIDATE: se uma linha audio aparecer na janela, VALIDATE falha
-- e a transação aborta sem deixar o CHECK antigo ativo.
-- ---------------------------------------------------------------------------
ALTER TABLE public.meta_messages
  DROP CONSTRAINT mm_message_type_check;

ALTER TABLE public.meta_messages
  ADD CONSTRAINT mm_message_type_check
  CHECK (message_type IN ('text', 'template', 'document', 'image', 'video'))
  NOT VALID;

ALTER TABLE public.meta_messages
  VALIDATE CONSTRAINT mm_message_type_check;


-- ---------------------------------------------------------------------------
-- Restaurar corpo da RPC de 20260924112100 (CREATE OR REPLACE, sem DROP).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_meta_inbound_media_message(
  p_company_id         UUID,
  p_instance_id        UUID,
  p_wa_id              TEXT,
  p_meta_message_id    TEXT,
  p_media_asset_id     UUID,
  p_contact_name       TEXT       DEFAULT NULL,
  p_provider_timestamp TIMESTAMPTZ DEFAULT NULL,
  p_message_type       TEXT       DEFAULT 'document'
)
RETURNS JSONB
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

  -- ── 0. Barreira: apenas service_role pode chamar esta função ─────────────────
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 1. Validar parâmetros obrigatórios ──────────────────────────────────────
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
  -- 'audio', 'sticker', 'interactive' e outros são rejeitados (não suportados ainda).
  IF p_message_type NOT IN ('document', 'image', 'video') THEN
    RAISE EXCEPTION
      'p_message_type inválido: %. Permitido: document, image, video',
      p_message_type
      USING ERRCODE = 'check_violation';
  END IF;

  -- ── 2. Validar instância Meta ─────────────────────────────────────────────
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

  -- ── 3. Validar media asset (defense-in-depth além da FK composta) ─────────
  -- Garante que o asset existe, pertence a esta empresa e tem file_type
  -- compatível com p_message_type antes de qualquer escrita.
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

  -- ── 4. Idempotência: verificação antecipada de wamid duplicado ───────────
  -- Otimização: evita conversation upsert e INSERT desnecessários em replay.
  -- Race residual tratado na seção 5b.
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

  -- ── 5. Criar ou localizar a conversa ──────────────────────────────────────
  -- Chave canônica: (company_id, instance_id, wa_id).
  -- contact_name: COALESCE preserva nome existente se o novo for NULL.
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

  -- ── 6. Inserir mensagem de mídia ──────────────────────────────────────────
  -- body = NULL: não inventar labels ('[Documento]' etc.).
  --   Labels são responsabilidade do frontend via p_message_type.
  -- media_asset_id: FK composta → company_media_library(company_id, id).
  -- ON CONFLICT DO NOTHING: race condition entre requests simultâneos.
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

  -- ── 6b. Race condition: recuperar IDs reais da mensagem vencedora ─────────
  -- Se v_message_id IS NULL, outro request ganhou a race.
  -- Retornamos created=false com IDs consistentes da linha vencedora.
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

  -- ── 7. Preview determinístico por tipo de mídia ────────────────────────────
  -- Usado SOMENTE em last_message_preview. NÃO gravado em meta_messages.body.
  v_preview := CASE p_message_type
    WHEN 'document' THEN 'Documento'
    WHEN 'image'    THEN 'Imagem'
    WHEN 'video'    THEN 'Vídeo'
    ELSE                 'Mídia'   -- fallback defensivo (não deve chegar aqui)
  END;

  -- ── 8. Atualizar estatísticas da conversa ─────────────────────────────────
  -- Somente o insert vencedor (v_message_id não-null) executa este bloco.
  -- Anti-regressão temporal: mesma lógica da RPC text.
  --   Caso A (ts conhecido): avança somente se >= last_message_at.
  --   Caso B (ts NULL):      avança somente se last_message_at era NULL.
  --   Caso contrário:        mantém valor existente (mensagem atrasada).
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

  -- ── 9. Retorno ────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'created',         true,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id
  );

END;
$function$;


COMMENT ON FUNCTION public.process_meta_inbound_media_message(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT
) IS
'Processa atomicamente uma mensagem inbound de MÍDIA (document/image/video) do '
'Meta WhatsApp Cloud API (INBOUND-DOC-C1/MVP3X+). '
'Pré-requisito: asset já persistido em company_media_library pelo backend. '
'Valida instância Meta ativa, asset (company + file_type), e persiste meta_messages '
'com body=NULL e media_asset_id. '
'Idempotente: wamid duplicado retorna created=false (early check ou race recovery). '
'Preview determinístico: Documento/Imagem/Vídeo em last_message_preview. '
'Timestamp anti-regressão: mensagem atrasada não sobrescreve last_message_at. '
'Acesso exclusivo de service_role (backend Vercel). '
'Autorização do usuário deve ocorrer ANTES no backend.';


REVOKE ALL ON FUNCTION public.process_meta_inbound_media_message(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.process_meta_inbound_media_message(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT
) FROM anon;

REVOKE ALL ON FUNCTION public.process_meta_inbound_media_message(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.process_meta_inbound_media_message(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT
) TO service_role;


COMMIT;
