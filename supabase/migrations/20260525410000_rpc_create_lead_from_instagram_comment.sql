-- =============================================================================
-- RPC: create_lead_from_instagram_comment
--
-- Objetivo: converter um Instagram Comment em Lead real do CRM.
--
-- Diferença da RPC de DM (create_or_link_instagram_lead):
--   - Resolve dados do participante via instagram_comments (não via instagram_conversations)
--   - Atualiza instagram_comments.lead_id e status = 'converted_to_lead'
--   - Se comment.conversation_id existir: também sincroniza instagram_conversations.lead_id
--
-- Regras de negócio:
--   - Nunca cria lead sem name + (phone OU email)
--   - company_id sempre resolvido via instagram_comments (nunca parâmetro)
--   - Deduplicação: phone → email → social profile
--   - Transação atômica com advisory lock
--   - SECURITY DEFINER + guard auth.role() — apenas service_role
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_lead_from_instagram_comment(
  p_comment_id   UUID,
  p_name         TEXT,
  p_performed_by UUID,
  p_phone        TEXT    DEFAULT NULL,
  p_email        TEXT    DEFAULT NULL,
  p_ip_address   TEXT    DEFAULT NULL,
  p_user_agent   TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comment              public.instagram_comments%ROWTYPE;
  v_phone_norm           TEXT;
  v_email_norm           TEXT;
  v_existing_lead_id     INTEGER;
  v_lead_id              INTEGER;
  v_matched_by           TEXT;
  v_is_duplicate         BOOLEAN := false;
  v_action               TEXT;
  v_social_profile_id    UUID;
  v_max_leads            INTEGER;
  v_current_leads        BIGINT;
  v_responsible_user_id  UUID;
  v_metadata             JSONB;
BEGIN
  -- ── Barreira de segurança ──────────────────────────────────────────────────
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 1. Carregar comentário ─────────────────────────────────────────────────
  SELECT * INTO v_comment
  FROM public.instagram_comments
  WHERE id = p_comment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'comment_not_found');
  END IF;

  -- ── 2. Idempotência: comentário já tem lead vinculado ─────────────────────
  IF v_comment.lead_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'action',  'already_linked',
      'lead_id', v_comment.lead_id
    );
  END IF;

  -- ── 3. Validar name ────────────────────────────────────────────────────────
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'name é obrigatório');
  END IF;

  -- ── 4. Validar contato real (phone OU email) ───────────────────────────────
  IF (p_phone IS NULL OR trim(p_phone) = '') AND (p_email IS NULL OR trim(p_email) = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'phone ou email é obrigatório');
  END IF;

  -- ── 5. Normalizar phone ────────────────────────────────────────────────────
  IF p_phone IS NOT NULL AND trim(p_phone) != '' THEN
    v_phone_norm := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');
    IF LENGTH(v_phone_norm) < 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'telefone deve ter pelo menos 10 dígitos');
    END IF;
  END IF;

  -- ── 6. Normalizar email ────────────────────────────────────────────────────
  IF p_email IS NOT NULL AND trim(p_email) != '' THEN
    v_email_norm := lower(trim(p_email));
    IF v_email_norm !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'email com formato inválido');
    END IF;
  END IF;

  -- ── 7. Advisory lock: serializar criações do mesmo participante ───────────
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ig_comment_lead:' || v_comment.company_id::TEXT || ':' || v_comment.ig_user_id, 0)
  );

  -- ── 8. Re-verificar após lock (TOCTOU) ─────────────────────────────────────
  SELECT lead_id INTO v_comment.lead_id
  FROM public.instagram_comments
  WHERE id = p_comment_id;

  IF v_comment.lead_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'action', 'already_linked', 'lead_id', v_comment.lead_id);
  END IF;

  -- ── 9. Deduplicação por telefone ───────────────────────────────────────────
  IF v_phone_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id = v_comment.company_id
      AND deleted_at IS NULL
      AND (
        REGEXP_REPLACE(phone, '[^0-9]', '', 'g') = v_phone_norm
        OR RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 11) = RIGHT(v_phone_norm, 11)
      )
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'phone';
    END IF;
  END IF;

  -- ── 10. Deduplicação por email ─────────────────────────────────────────────
  IF v_existing_lead_id IS NULL AND v_email_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id        = v_comment.company_id
      AND deleted_at        IS NULL
      AND lower(trim(email)) = v_email_norm
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'email';
    END IF;
  END IF;

  -- ── 11. Deduplicação por perfil social ────────────────────────────────────
  IF v_existing_lead_id IS NULL THEN
    SELECT lead_id INTO v_existing_lead_id
    FROM public.lead_social_profiles
    WHERE company_id       = v_comment.company_id
      AND provider         = 'instagram'
      AND provider_user_id = v_comment.ig_user_id
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'social_profile';
    END IF;
  END IF;

  -- ── 12. Lead existente: vincular ───────────────────────────────────────────
  IF v_existing_lead_id IS NOT NULL THEN
    v_lead_id      := v_existing_lead_id;
    v_is_duplicate := true;
    v_action       := 'lead_linked';

  -- ── 13. Lead novo: verificar limite do plano e criar ──────────────────────
  ELSE
    SELECT pl.max_leads INTO v_max_leads
    FROM   public.companies  c
    LEFT JOIN public.plans   pl ON pl.id = c.plan_id AND pl.is_active = true
    WHERE  c.id = v_comment.company_id;

    IF v_max_leads IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_leads
      FROM   public.leads
      WHERE  company_id = v_comment.company_id
        AND  deleted_at IS NULL;

      IF v_current_leads >= v_max_leads THEN
        RETURN jsonb_build_object(
          'success',     false,
          'error',       'plan_limit_exceeded',
          'max_allowed', v_max_leads,
          'current',     v_current_leads
        );
      END IF;
    END IF;

    INSERT INTO public.leads (
      company_id, name, phone, email, origin, status,
      responsible_user_id, record_type, is_over_plan, created_at, updated_at
    ) VALUES (
      v_comment.company_id,
      trim(p_name),
      NULLIF(trim(COALESCE(p_phone, '')), ''),
      NULLIF(trim(COALESCE(p_email, '')), ''),
      'instagram',
      'novo',
      NULL,
      'Lead',
      false,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_lead_id;

    v_is_duplicate := false;
    v_action       := 'lead_created';
  END IF;

  -- ── 14. UPSERT lead_social_profiles ───────────────────────────────────────
  INSERT INTO public.lead_social_profiles (
    lead_id, company_id, provider, provider_user_id,
    username, display_name, avatar_url, created_at, updated_at
  ) VALUES (
    v_lead_id,
    v_comment.company_id,
    'instagram',
    v_comment.ig_user_id,
    v_comment.ig_username,
    trim(p_name),
    NULL,
    NOW(),
    NOW()
  )
  ON CONFLICT (company_id, provider, provider_user_id) DO UPDATE SET
    lead_id      = EXCLUDED.lead_id,
    username     = COALESCE(EXCLUDED.username,     lead_social_profiles.username),
    display_name = COALESCE(EXCLUDED.display_name, lead_social_profiles.display_name),
    updated_at   = NOW()
  RETURNING id INTO v_social_profile_id;

  -- ── 15. Atualizar comentário ───────────────────────────────────────────────
  UPDATE public.instagram_comments
  SET    lead_id    = v_lead_id,
         status     = 'converted_to_lead',
         updated_at = NOW()
  WHERE  id = p_comment_id;

  -- ── 16. Sincronizar conversa vinculada (se existir) ────────────────────────
  IF v_comment.conversation_id IS NOT NULL THEN
    UPDATE public.instagram_conversations
    SET    lead_id    = v_lead_id,
           updated_at = NOW()
    WHERE  id = v_comment.conversation_id;
  END IF;

  -- ── 17. Audit log ──────────────────────────────────────────────────────────
  v_metadata := jsonb_build_object(
    'comment_id',     p_comment_id,
    'lead_id',        v_lead_id,
    'matched_by',     v_matched_by,
    'is_duplicate',   v_is_duplicate,
    'ig_user_id',     v_comment.ig_user_id,
    'ig_username',    v_comment.ig_username,
    'action',         v_action
  );

  IF v_phone_norm IS NOT NULL AND LENGTH(v_phone_norm) >= 4 THEN
    v_metadata := v_metadata || jsonb_build_object('phone_last4', RIGHT(v_phone_norm, 4));
  END IF;

  IF v_email_norm IS NOT NULL THEN
    v_metadata := v_metadata || jsonb_build_object('email_domain', SPLIT_PART(v_email_norm, '@', 2));
  END IF;

  INSERT INTO public.instagram_audit_logs (
    company_id, connection_id, action, performed_by,
    ip_address, user_agent, metadata
  ) VALUES (
    v_comment.company_id,
    v_comment.connection_id,
    v_action,
    p_performed_by,
    p_ip_address,
    p_user_agent,
    v_metadata
  );

  -- ── 18. Retornar resultado ─────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',           true,
    'action',            v_action,
    'lead_id',           v_lead_id,
    'social_profile_id', v_social_profile_id,
    'matched_by',        v_matched_by,
    'is_duplicate',      v_is_duplicate
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_lead_from_instagram_comment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_instagram_comment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_lead_from_instagram_comment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM authenticated;

GRANT EXECUTE ON FUNCTION public.create_lead_from_instagram_comment(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
