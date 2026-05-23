-- =============================================================================
-- FASE 2 — Integração Instagram (RPC 2/3)
-- Função: process_instagram_comment_webhook
--
-- Objetivo: processar um evento de comentário recebido via webhook.
--   1. Resolve company_id via instagram_user_id (NUNCA aceita company_id direto)
--   2. Garante idempotência por ig_comment_id
--   3. Resolve parent_comment_id (se for reply) via ig_comment_id do pai
--   4. Tenta vincular lead via lead_social_profiles
--   5. Insere comentário (ON CONFLICT DO NOTHING)
--
-- IMPORTANTE:
--   - Comentário NÃO cria lead automaticamente
--   - Callable apenas por service_role (backend de webhook)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_instagram_comment_webhook(
  p_instagram_user_id      TEXT,
  p_ig_comment_id          TEXT,
  p_ig_media_id            TEXT,
  p_ig_user_id             TEXT,
  p_content                TEXT,
  p_timestamp              TIMESTAMPTZ,
  p_ig_media_type          TEXT        DEFAULT NULL,
  p_ig_username            TEXT        DEFAULT NULL,
  p_parent_ig_comment_id   TEXT        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection        public.instagram_connections%ROWTYPE;
  v_parent_comment_id UUID    := NULL;
  v_lead_id           INTEGER := NULL;
  v_comment_existed   BOOLEAN := false;
BEGIN
  -- Barreira de segurança: apenas service_role pode chamar esta função
  -- O Supabase concede EXECUTE para authenticated automaticamente via PostgREST;
  -- esta validação interna impede chamadas não autorizadas mesmo assim.
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta funcao e exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. Resolver conexão via instagram_user_id
  SELECT *
    INTO v_connection
    FROM public.instagram_connections
   WHERE instagram_user_id = p_instagram_user_id
     AND status = 'active'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok',    false,
      'error', 'connection_not_found',
      'detail', format('Nenhuma conexão ativa para instagram_user_id = %s', p_instagram_user_id)
    );
  END IF;

  -- 2. Idempotência: verificar se o comentário já foi processado
  SELECT EXISTS(
    SELECT 1 FROM public.instagram_comments
     WHERE ig_comment_id = p_ig_comment_id
  ) INTO v_comment_existed;

  IF v_comment_existed THEN
    RETURN jsonb_build_object(
      'ok',      true,
      'skipped', true,
      'reason',  'duplicate_comment'
    );
  END IF;

  -- 3. Resolver UUID do comentário pai (se for reply)
  IF p_parent_ig_comment_id IS NOT NULL THEN
    SELECT id
      INTO v_parent_comment_id
      FROM public.instagram_comments
     WHERE ig_comment_id = p_parent_ig_comment_id
       AND company_id    = v_connection.company_id
     LIMIT 1;
    -- Se o pai não existir ainda, parent_comment_id fica NULL (aceito)
  END IF;

  -- 4. Tentar vincular lead existente via lead_social_profiles
  SELECT lsp.lead_id
    INTO v_lead_id
    FROM public.lead_social_profiles lsp
   WHERE lsp.company_id       = v_connection.company_id
     AND lsp.provider         = 'instagram'
     AND lsp.provider_user_id = p_ig_user_id
   LIMIT 1;

  -- 5. Inserir comentário (ON CONFLICT DO NOTHING — idempotência)
  INSERT INTO public.instagram_comments (
    company_id,
    connection_id,
    ig_comment_id,
    ig_media_id,
    ig_media_type,
    ig_user_id,
    ig_username,
    content,
    parent_comment_id,
    lead_id,
    status,
    timestamp,
    created_at,
    updated_at
  )
  VALUES (
    v_connection.company_id,
    v_connection.id,
    p_ig_comment_id,
    p_ig_media_id,
    p_ig_media_type,
    p_ig_user_id,
    p_ig_username,
    p_content,
    v_parent_comment_id,
    v_lead_id,
    'pending',
    p_timestamp,
    now(),
    now()
  )
  ON CONFLICT (ig_comment_id) DO NOTHING;

  RETURN jsonb_build_object(
    'ok',             true,
    'skipped',        false,
    'company_id',     v_connection.company_id,
    'connection_id',  v_connection.id,
    'lead_id',        v_lead_id
  );
END;
$$;

-- Callable apenas por service_role (backend de webhook)
REVOKE EXECUTE ON FUNCTION public.process_instagram_comment_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.process_instagram_comment_webhook(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO service_role;
