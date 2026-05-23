-- =============================================================================
-- Integração Instagram (RPC 4/4)
-- Função: create_or_link_instagram_lead
--
-- Objetivo: converter um Instagram Contact em Lead real do CRM.
--
-- Regras de negócio:
--   - Nunca cria lead sem name + (phone OU email)
--   - company_id sempre resolvido via instagram_conversations (nunca parâmetro)
--   - Deduplicação por: phone (REGEXP + RIGHT(11)) → email → social profile
--   - Se lead existir: vincula conversa; não cria duplicata
--   - Se lead não existir: INSERT — triggers oficiais criam opp/funil/entry
--   - UPSERT em lead_social_profiles (phone/email prevalece sobre social)
--   - Transação atômica: rollback total em qualquer falha
--   - Advisory lock por (company_id, ig_participant_id) para evitar race condition
--
-- SEGURANÇA:
--   - SECURITY DEFINER + guard auth.role()
--   - Apenas service_role pode executar
--   - company_id NUNCA é parâmetro externo
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_or_link_instagram_lead(
  p_conversation_id UUID,
  p_name            TEXT,
  p_performed_by    UUID,
  p_phone           TEXT    DEFAULT NULL,
  p_email           TEXT    DEFAULT NULL,
  p_ip_address      TEXT    DEFAULT NULL,
  p_user_agent      TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv                 public.instagram_conversations%ROWTYPE;
  v_responsible_user_id  UUID;
  v_phone_norm           TEXT;
  v_email_norm           TEXT;
  -- leads.id é SMALLINT (int2) — widening implícito PL/pgSQL cobre as atribuições.
  v_existing_lead_id     SMALLINT;
  v_lead_id              SMALLINT;
  v_matched_by           TEXT;
  v_is_duplicate         BOOLEAN := false;
  v_action               TEXT;
  v_social_profile_id    UUID;
  v_max_leads            INTEGER;
  v_current_leads        BIGINT;
  v_metadata             JSONB;
BEGIN
  -- ── Barreira de segurança ─────────────────────────────────────────────────
  -- Impede chamadas diretas de clientes authenticated (PostgREST).
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 1. Carregar conversa (resolve company_id, connection_id, participante) ─
  SELECT * INTO v_conv
  FROM public.instagram_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'conversation_not_found');
  END IF;

  -- ── 2. Validar name ────────────────────────────────────────────────────────
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'validation_error',
      'detail',  'name é obrigatório'
    );
  END IF;

  -- ── 3. Validar contato real (phone OU email) ───────────────────────────────
  IF (p_phone IS NULL OR trim(p_phone) = '')
     AND (p_email IS NULL OR trim(p_email) = '') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'validation_error',
      'detail',  'phone ou email é obrigatório'
    );
  END IF;

  -- ── 4. Normalizar phone ────────────────────────────────────────────────────
  IF p_phone IS NOT NULL AND trim(p_phone) != '' THEN
    v_phone_norm := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');
    IF LENGTH(v_phone_norm) < 10 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'validation_error',
        'detail',  'telefone deve ter pelo menos 10 dígitos'
      );
    END IF;
  END IF;

  -- ── 5. Normalizar email ────────────────────────────────────────────────────
  IF p_email IS NOT NULL AND trim(p_email) != '' THEN
    v_email_norm := lower(trim(p_email));
    IF v_email_norm !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'validation_error',
        'detail',  'email com formato inválido'
      );
    END IF;
  END IF;

  -- ── 6. Idempotência rápida: conversa já tem lead vinculado ─────────────────
  IF v_conv.lead_id IS NOT NULL THEN
    -- Best-effort: garantir social profile consistente
    INSERT INTO public.lead_social_profiles (
      lead_id, company_id, provider, provider_user_id,
      username, display_name, avatar_url,
      created_at, updated_at
    ) VALUES (
      v_conv.lead_id,
      v_conv.company_id,
      'instagram',
      v_conv.ig_participant_id,
      v_conv.participant_username,
      COALESCE(v_conv.participant_name, trim(p_name)),
      v_conv.participant_avatar,
      NOW(),
      NOW()
    )
    ON CONFLICT (company_id, provider, provider_user_id) DO NOTHING;

    -- Registrar tentativa idempotente
    INSERT INTO public.instagram_audit_logs (
      company_id, connection_id, action, performed_by,
      ip_address, user_agent, metadata
    ) VALUES (
      v_conv.company_id,
      v_conv.connection_id,
      'lead_already_linked',
      p_performed_by,
      p_ip_address,
      p_user_agent,
      jsonb_build_object(
        'conversation_id',    p_conversation_id,
        'lead_id',            v_conv.lead_id,
        'ig_participant_id',  v_conv.ig_participant_id,
        'participant_username', v_conv.participant_username
      )
    );

    RETURN jsonb_build_object(
      'success',         true,
      'action',          'already_linked',
      'lead_id',         v_conv.lead_id,
      'conversation_id', p_conversation_id
    );
  END IF;

  -- ── 7. Advisory lock: serializar criações do mesmo participante por empresa ─
  -- Evita race condition em double-click / requisições paralelas.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ig_lead:' || v_conv.company_id::TEXT || ':' || v_conv.ig_participant_id, 0)
  );

  -- ── 8. Re-verificar após lock (TOCTOU) ─────────────────────────────────────
  SELECT lead_id INTO v_conv.lead_id
  FROM public.instagram_conversations
  WHERE id = p_conversation_id;

  IF v_conv.lead_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success',         true,
      'action',          'already_linked',
      'lead_id',         v_conv.lead_id,
      'conversation_id', p_conversation_id
    );
  END IF;

  -- ── 9. Deduplicação por telefone ───────────────────────────────────────────
  -- Padrão WhatsApp: match exato OU RIGHT(11) para cobrir DDI variável.
  IF v_phone_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id  = v_conv.company_id
      AND deleted_at  IS NULL
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

  -- ── 10. Deduplicação por email ────────────────────────────────────────────
  IF v_existing_lead_id IS NULL AND v_email_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id          = v_conv.company_id
      AND deleted_at          IS NULL
      AND lower(trim(email))  = v_email_norm
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
    WHERE company_id       = v_conv.company_id
      AND provider         = 'instagram'
      AND provider_user_id = v_conv.ig_participant_id
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'social_profile';
    END IF;
  END IF;

  -- ── 12. Resolver responsible_user_id ──────────────────────────────────────
  -- Prioridade: assigned_to da conversa → default_assignee da empresa → NULL
  SELECT COALESCE(v_conv.assigned_to, s.default_assignee)
  INTO   v_responsible_user_id
  FROM   public.instagram_company_settings s
  WHERE  s.company_id = v_conv.company_id;

  IF NOT FOUND THEN
    v_responsible_user_id := v_conv.assigned_to;
  END IF;

  -- ── 13A. Lead existente: vincular ─────────────────────────────────────────
  IF v_existing_lead_id IS NOT NULL THEN
    v_lead_id      := v_existing_lead_id;
    v_is_duplicate := true;
    v_action       := 'lead_linked';

  -- ── 13B. Lead novo: verificar limite do plano e criar ─────────────────────
  ELSE
    SELECT pl.max_leads INTO v_max_leads
    FROM   public.companies  c
    LEFT JOIN public.plans   pl ON pl.id = c.plan_id AND pl.is_active = true
    WHERE  c.id = v_conv.company_id;

    IF v_max_leads IS NOT NULL THEN
      SELECT COUNT(*) INTO v_current_leads
      FROM   public.leads
      WHERE  company_id = v_conv.company_id
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

    -- INSERT lead.
    -- Triggers oficiais criam automaticamente: oportunidade, posição no funil,
    -- lead_entry inicial, dedup check e webhook trigger.
    INSERT INTO public.leads (
      company_id,
      name,
      phone,
      email,
      origin,
      status,
      responsible_user_id,
      record_type,
      is_over_plan,
      created_at,
      updated_at
    ) VALUES (
      v_conv.company_id,
      trim(p_name),
      NULLIF(trim(COALESCE(p_phone, '')), ''),
      NULLIF(trim(COALESCE(p_email, '')), ''),
      'instagram',
      'novo',
      v_responsible_user_id,
      'Lead',
      false,
      NOW(),
      NOW()
    )
    RETURNING id INTO v_lead_id;

    v_is_duplicate := false;
    v_action       := 'lead_created';
  END IF;

  -- ── 14. UPSERT lead_social_profiles ──────────────────────────────────────
  -- phone/email prevalece: se social profile apontava para outro lead,
  -- atualizar para o lead vencedor da dedup.
  INSERT INTO public.lead_social_profiles (
    lead_id,
    company_id,
    provider,
    provider_user_id,
    username,
    display_name,
    avatar_url,
    created_at,
    updated_at
  ) VALUES (
    v_lead_id,
    v_conv.company_id,
    'instagram',
    v_conv.ig_participant_id,
    v_conv.participant_username,
    COALESCE(v_conv.participant_name, trim(p_name)),
    v_conv.participant_avatar,
    NOW(),
    NOW()
  )
  ON CONFLICT (company_id, provider, provider_user_id) DO UPDATE SET
    lead_id      = EXCLUDED.lead_id,
    username     = COALESCE(EXCLUDED.username,     lead_social_profiles.username),
    display_name = COALESCE(EXCLUDED.display_name, lead_social_profiles.display_name),
    avatar_url   = COALESCE(EXCLUDED.avatar_url,   lead_social_profiles.avatar_url),
    updated_at   = NOW()
  RETURNING id INTO v_social_profile_id;

  -- ── 15. Atualizar conversa ────────────────────────────────────────────────
  UPDATE public.instagram_conversations
  SET    lead_id    = v_lead_id,
         updated_at = NOW()
  WHERE  id = p_conversation_id;

  -- ── 16. Audit log ─────────────────────────────────────────────────────────
  -- Mascarar dados sensíveis: apenas phone_last4 e email_domain.
  v_metadata := jsonb_build_object(
    'conversation_id',     p_conversation_id,
    'lead_id',             v_lead_id,
    'matched_by',          v_matched_by,
    'is_duplicate',        v_is_duplicate,
    'ig_participant_id',   v_conv.ig_participant_id,
    'participant_username', v_conv.participant_username,
    'action',              v_action
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
    v_conv.company_id,
    v_conv.connection_id,
    v_action,
    p_performed_by,
    p_ip_address,
    p_user_agent,
    v_metadata
  );

  -- ── 17. Retornar resultado ─────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'success',           true,
    'action',            v_action,
    'lead_id',           v_lead_id,
    'conversation_id',   p_conversation_id,
    'social_profile_id', v_social_profile_id,
    'matched_by',        v_matched_by,
    'is_duplicate',      v_is_duplicate
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── Permissões ────────────────────────────────────────────────────────────────
-- Revogar de todos; conceder apenas para service_role.
-- Guard interno (auth.role()) é a segunda camada de proteção.
REVOKE EXECUTE ON FUNCTION public.create_or_link_instagram_lead(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_or_link_instagram_lead(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_or_link_instagram_lead(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM authenticated;

GRANT EXECUTE ON FUNCTION public.create_or_link_instagram_lead(UUID, TEXT, UUID, TEXT, TEXT, TEXT, TEXT)
  TO service_role;
