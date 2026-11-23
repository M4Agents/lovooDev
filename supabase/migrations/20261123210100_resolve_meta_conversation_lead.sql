-- =============================================================================
-- Migration: resolve_meta_conversation_lead
-- Timestamp: 20261123210100
--
-- Cria a resolução automática de lead para conversas Meta e chama essa
-- resolução nos retornos das RPCs de inbound já existentes.
--
-- Não altera tabelas, índices, RLS, funções Uazapi nem o vínculo manual.
-- Não aplicar nesta etapa. DEV e produção compartilham o mesmo banco.
--
-- Ordem de locks do caminho Meta, alinhada ao vínculo manual:
--   advisory lock do telefone -> leads (id crescente) -> meta_conversations.
-- A preparação não insere lead e não bloqueia a conversa.
-- A criação e o vínculo do lead novo ficam numa subtransação BEGIN/EXCEPTION.
-- Se o vínculo manual já venceu, a subtransação desfaz só esse lead.
-- SQLSTATE internos: MC001 vínculo manual, MC002 duplicidade, MC003 funil.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.acquire_meta_lead_phone_locks(
  p_company_id uuid,
  p_wa_id      text
)
RETURNS TABLE (
  prepared_decision text,
  prepared_lead_id  integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  v_digits    text;
  v_phone     text;
  v_count     integer;
  v_locked_id integer;
BEGIN
  prepared_decision := NULL;
  prepared_lead_id := NULL;

  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'identidade Meta incompleta'
      USING ERRCODE = 'check_violation';
  END IF;

  v_digits := pg_catalog.regexp_replace(COALESCE(p_wa_id, ''), '[^0-9]', '', 'g');

  IF v_digits IS NULL OR v_digits = '' OR pg_catalog.char_length(v_digits) < 12 THEN
    prepared_decision := 'invalid_phone';
    RETURN NEXT;
    RETURN;
  END IF;

  v_phone := public.canonicalize_br_mobile_phone(v_digits);

  IF v_phone IS NULL OR v_phone !~ '^55[0-9]{2}9[0-9]{8}$' THEN
    prepared_decision := 'invalid_phone';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Mesma chave da Uazapi. Só então os leads, em ordem estável de id.
  -- Não lê a conversa, não insere lead e não altera lead existente.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lead_create_wa:' || p_company_id::text || ':' || v_phone,
      0
    )
  );

  SELECT COUNT(*)::integer, MIN(locked.id)
    INTO v_count, v_locked_id
    FROM (
      SELECT l.id
        FROM public.leads AS l
       WHERE l.company_id = p_company_id
         AND l.deleted_at IS NULL
         AND l.phone IS NOT NULL
         AND pg_catalog.btrim(l.phone) <> ''
         AND (
           l.phone_normalized = v_phone
           OR public.canonicalize_br_mobile_phone(l.phone) = v_phone
         )
       ORDER BY l.id
         FOR NO KEY UPDATE
    ) AS locked;

  IF v_count > 1 THEN
    prepared_decision := 'ambiguous';
    prepared_lead_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_count = 1 THEN
    prepared_decision := 'link_existing';
    prepared_lead_id := v_locked_id;
    RETURN NEXT;
    RETURN;
  END IF;

  prepared_decision := 'needs_create';
  prepared_lead_id := NULL;
  RETURN NEXT;
  RETURN;
END;
$function$;

COMMENT ON FUNCTION public.acquire_meta_lead_phone_locks(uuid, text) IS
  'Prepara o telefone Meta antes de qualquer lock em meta_conversations. '
  'Trava o advisory lock e os candidatos em ordem de id. Não insere lead. '
  'Retorna invalid_phone, ambiguous, link_existing ou needs_create.';

REVOKE ALL ON FUNCTION public.acquire_meta_lead_phone_locks(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.acquire_meta_lead_phone_locks(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.acquire_meta_lead_phone_locks(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_meta_lead_phone_locks(uuid, text) TO service_role;

-- MC001: o vínculo manual já está commitado; desfaz somente o lead desta subtransação.
-- MC002: a criação local é duplicata; desfaz o lead e não trava o lead externo.
-- MC003: o funil não gerou uma oportunidade e uma posição; desfaz o lead.
CREATE OR REPLACE FUNCTION private.create_and_link_meta_conversation_lead(
  p_company_id   uuid,
  p_instance_id  uuid,
  p_wa_id        text,
  p_contact_name text
)
RETURNS TABLE (
  outcome         text,
  conversation_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  v_digits        text;
  v_phone         text;
  v_name          text;
  v_existing_lead integer;
  v_new_id        integer;
  v_is_duplicate  boolean;
  v_opp_count     integer;
  v_pos_count     integer;
  v_max_leads     integer;
  v_current_leads bigint;
  v_is_over_plan  boolean := false;
  v_conv          public.meta_conversations%ROWTYPE;
  v_instance_ok   boolean;
BEGIN
  outcome := NULL;
  conversation_id := NULL;

  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NULL OR p_instance_id IS NULL THEN
    RAISE EXCEPTION 'identidade Meta incompleta'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.meta_whatsapp_instances AS i
     WHERE i.id = p_instance_id
       AND i.company_id = p_company_id
       AND i.deleted_at IS NULL
  )
    INTO v_instance_ok;

  IF NOT v_instance_ok THEN
    RAISE EXCEPTION 'instância Meta removida ou divergente'
      USING ERRCODE = 'no_data_found';
  END IF;

  v_digits := pg_catalog.regexp_replace(COALESCE(p_wa_id, ''), '[^0-9]', '', 'g');
  v_phone := public.canonicalize_br_mobile_phone(v_digits);

  IF v_digits IS NULL
     OR pg_catalog.char_length(v_digits) < 12
     OR v_phone IS NULL
     OR v_phone !~ '^55[0-9]{2}9[0-9]{8}$' THEN
    RAISE EXCEPTION 'telefone Meta inválido para criação'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Leitura sem lock. Se o vínculo já está visível, não cria lead.
  SELECT mc.lead_id
    INTO v_existing_lead
    FROM public.meta_conversations AS mc
   WHERE mc.company_id = p_company_id
     AND mc.instance_id = p_instance_id
     AND mc.wa_id = p_wa_id;

  IF FOUND AND v_existing_lead IS NOT NULL THEN
    outcome := 'already_linked';
    RETURN NEXT;
    RETURN;
  END IF;

  v_name := NULLIF(pg_catalog.btrim(COALESCE(p_contact_name, '')), '');
  IF v_name IS NULL THEN
    v_name := 'Lead WhatsApp';
  END IF;

  BEGIN
    SELECT pl.max_leads
      INTO v_max_leads
      FROM public.companies AS c
      LEFT JOIN public.plans AS pl
        ON pl.id = c.plan_id
       AND pl.is_active = true
     WHERE c.id = p_company_id;

    IF v_max_leads IS NOT NULL THEN
      SELECT COUNT(*)
        INTO v_current_leads
        FROM public.leads AS l
       WHERE l.company_id = p_company_id
         AND l.deleted_at IS NULL;

      IF v_current_leads >= v_max_leads THEN
        v_is_over_plan := true;
      END IF;
    END IF;

    INSERT INTO public.leads (
      company_id,
      phone,
      name,
      origin,
      status,
      record_type,
      responsible_user_id,
      is_over_plan
    ) VALUES (
      p_company_id,
      v_phone,
      v_name,
      'whatsapp',
      'novo',
      'Lead',
      NULL,
      v_is_over_plan
    )
    RETURNING id INTO v_new_id;

    SELECT COALESCE(l.is_duplicate, false)
      INTO v_is_duplicate
      FROM public.leads AS l
     WHERE l.id = v_new_id;

    IF v_is_duplicate THEN
      RAISE EXCEPTION 'meta_lead_duplicate_race'
        USING ERRCODE = 'MC002';
    END IF;

    SELECT COUNT(*)::integer
      INTO v_opp_count
      FROM public.opportunities AS o
     WHERE o.lead_id = v_new_id
       AND o.company_id = p_company_id;

    SELECT COUNT(*)::integer
      INTO v_pos_count
      FROM public.opportunity_funnel_positions AS p
     WHERE p.lead_id = v_new_id;

    IF v_opp_count <> 1 OR v_pos_count <> 1 THEN
      RAISE EXCEPTION 'meta_lead_funnel_incomplete'
        USING ERRCODE = 'MC003';
    END IF;

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
    ) VALUES (
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
    RETURNING * INTO v_conv;

    IF v_conv.company_id IS DISTINCT FROM p_company_id
       OR v_conv.instance_id IS DISTINCT FROM p_instance_id
       OR v_conv.wa_id IS DISTINCT FROM p_wa_id THEN
      RAISE EXCEPTION 'identidade Meta divergente'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT EXISTS (
      SELECT 1
        FROM public.meta_whatsapp_instances AS i
       WHERE i.id = v_conv.instance_id
         AND i.company_id = v_conv.company_id
         AND i.deleted_at IS NULL
    )
      INTO v_instance_ok;

    IF NOT v_instance_ok THEN
      RAISE EXCEPTION 'instância Meta removida ou divergente'
        USING ERRCODE = 'no_data_found';
    END IF;

    IF v_conv.lead_id IS NOT NULL THEN
      RAISE EXCEPTION 'meta_lead_manual_link_won'
        USING ERRCODE = 'MC001';
    END IF;

    UPDATE public.meta_conversations AS mc
       SET lead_id = v_new_id
     WHERE mc.id = v_conv.id
       AND mc.company_id = v_conv.company_id
       AND mc.instance_id = v_conv.instance_id
       AND mc.lead_id IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'vínculo Meta não aplicado'
        USING ERRCODE = 'check_violation';
    END IF;

    outcome := 'created_and_linked';
    conversation_id := v_conv.id;
  EXCEPTION
    WHEN deadlock_detected OR serialization_failure THEN
      RAISE;
    WHEN SQLSTATE 'MC001' THEN
      outcome := 'already_linked';
      conversation_id := NULL;
    WHEN SQLSTATE 'MC002' THEN
      RAISE LOG 'create_and_link_meta_conversation_lead outcome=duplicate_race company_id=%',
        p_company_id;
      outcome := 'lead_not_created';
      conversation_id := NULL;
    WHEN SQLSTATE 'MC003' THEN
      RAISE LOG 'create_and_link_meta_conversation_lead outcome=funnel_incomplete company_id=%',
        p_company_id;
      outcome := 'lead_not_created';
      conversation_id := NULL;
  END;

  RETURN NEXT;
  RETURN;
END;
$function$;

COMMENT ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) IS
  'Cria o lead Meta e tenta vinculá-lo na mesma subtransação. '
  'MC001 desfaz o lead quando o vínculo manual já venceu. '
  'MC002 e MC003 desfazem a criação e preservam a mensagem. '
  'Não é concedida a service_role, authenticated nem anon.';

REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM service_role;

CREATE OR REPLACE FUNCTION private.apply_meta_prepared_conversation_lead(
  p_company_id      uuid,
  p_instance_id     uuid,
  p_conversation_id uuid,
  p_wa_id           text,
  p_decision        text,
  p_lead_id         integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  v_conv        public.meta_conversations%ROWTYPE;
  v_instance_ok boolean;
  v_linked_id   integer;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NULL OR p_instance_id IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'identidade Meta incompleta'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_decision IS DISTINCT FROM 'link_existing' OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'preparação Meta sem lead'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.*
    INTO v_conv
    FROM public.meta_conversations AS c
   WHERE c.id = p_conversation_id
     AND c.company_id = p_company_id
     AND c.instance_id = p_instance_id
     AND c.wa_id = p_wa_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'identidade Meta divergente'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.meta_whatsapp_instances AS i
     WHERE i.id = v_conv.instance_id
       AND i.company_id = v_conv.company_id
       AND i.deleted_at IS NULL
  )
    INTO v_instance_ok;

  IF NOT v_instance_ok THEN
    RAISE EXCEPTION 'instância Meta removida ou divergente'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_conv.lead_id IS NOT NULL THEN
    RETURN 'already_linked';
  END IF;

  UPDATE public.meta_conversations AS mc
     SET lead_id = p_lead_id
   WHERE mc.id = v_conv.id
     AND mc.company_id = v_conv.company_id
     AND mc.instance_id = v_conv.instance_id
     AND mc.lead_id IS NULL;

  IF NOT FOUND THEN
    SELECT mc.lead_id
      INTO v_linked_id
      FROM public.meta_conversations AS mc
     WHERE mc.id = v_conv.id
       AND mc.company_id = v_conv.company_id
       AND mc.instance_id = v_conv.instance_id;

    IF v_linked_id IS NOT NULL THEN
      RETURN 'already_linked';
    END IF;

    RAISE EXCEPTION 'vínculo Meta não aplicado'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN 'linked_existing';
END;
$function$;

COMMENT ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) IS
  'Vincula somente o lead já bloqueado pela preparação. '
  'Não cria, não exclui e não substitui vínculo existente.';

REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM authenticated;
REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM service_role;

CREATE OR REPLACE FUNCTION public.resolve_meta_conversation_lead(
  p_company_id      uuid,
  p_instance_id     uuid,
  p_conversation_id uuid,
  p_wa_id           text,
  p_contact_name    text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  v_conv        public.meta_conversations%ROWTYPE;
  v_instance_ok boolean;
  v_decision    text;
  v_lead_id     integer;
  v_outcome     text;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NULL OR p_instance_id IS NULL OR p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'identidade Meta incompleta'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT c.*
    INTO v_conv
    FROM public.meta_conversations AS c
   WHERE c.id = p_conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conversa Meta não encontrada'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_conv.company_id IS DISTINCT FROM p_company_id
     OR v_conv.instance_id IS DISTINCT FROM p_instance_id
     OR v_conv.wa_id IS DISTINCT FROM p_wa_id THEN
    RAISE EXCEPTION 'identidade Meta divergente'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.meta_whatsapp_instances AS i
     WHERE i.id = v_conv.instance_id
       AND i.company_id = v_conv.company_id
       AND i.deleted_at IS NULL
  )
    INTO v_instance_ok;

  IF NOT v_instance_ok THEN
    RAISE EXCEPTION 'instância Meta removida ou divergente'
      USING ERRCODE = 'no_data_found';
  END IF;

  SELECT prepared.prepared_decision, prepared.prepared_lead_id
    INTO v_decision, v_lead_id
    FROM public.acquire_meta_lead_phone_locks(
      v_conv.company_id,
      v_conv.wa_id
    ) AS prepared;

  IF v_decision = 'needs_create' THEN
    SELECT created.outcome
      INTO v_outcome
      FROM private.create_and_link_meta_conversation_lead(
        v_conv.company_id,
        v_conv.instance_id,
        v_conv.wa_id,
        COALESCE(p_contact_name, v_conv.contact_name)
      ) AS created;

    RETURN v_outcome;
  END IF;

  IF v_decision = 'link_existing' THEN
    RETURN private.apply_meta_prepared_conversation_lead(
      v_conv.company_id,
      v_conv.instance_id,
      v_conv.id,
      v_conv.wa_id,
      v_decision,
      v_lead_id
    );
  END IF;

  RETURN v_decision;
END;
$function$;

COMMENT ON FUNCTION public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text) IS
  'Resolve o lead de uma conversa Meta já persistida. '
  'A preparação ocorre antes do lock da conversa. '
  'EXECUTE exclusivo de service_role.';

REVOKE ALL ON FUNCTION public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_meta_conversation_lead(uuid, uuid, uuid, text, text) TO service_role;


-- =============================================================================
-- Inbound texto: mesma assinatura. O retry anterior ao UPSERT chama resolve.
-- A mensagem é inserida depois da criação ou do segundo UPSERT.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_meta_inbound_message(
  p_company_id         UUID,
  p_instance_id        UUID,
  p_wa_id              TEXT,
  p_meta_message_id    TEXT,
  p_body               TEXT,
  p_contact_name       TEXT        DEFAULT NULL,
  p_provider_timestamp TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversation_id       UUID;
  v_message_id            UUID;
  v_existing_contact_name TEXT;
  v_decision              TEXT;
  v_prepared_lead_id      INTEGER;
BEGIN

  -- ── 0. Barreira: apenas service_role pode chamar esta função ───────────────
  -- Defesa em profundidade: Supabase concede EXECUTE a authenticated via
  -- PostgREST automaticamente em alguns contextos; esta verificação interna
  -- impede chamadas não autorizadas mesmo se os GRANTs externos falharem.
  -- Padrão: process_instagram_dm_webhook.
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta função é exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── 1. Validar parâmetros obrigatórios ────────────────────────────────────
  -- Os tipos UUID garantem NOT NULL estruturalmente.
  -- Para TEXT, verificar também string vazia (inválida no domínio).
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

  -- ── 2. Validar instância Meta ────────────────────────────────────────────
  -- Verificar que (company_id, instance_id) corresponde a uma instância real
  -- e não removida (soft-delete via deleted_at).
  -- Não confiar apenas na FK de meta_conversations para esta validação:
  -- a FK garante integridade referencial, mas não detecta instâncias deletadas.
  -- Autorização de acesso do usuário deve ocorrer no backend ANTES de invocar.
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

  -- ── 3. Idempotência: verificação antecipada de wamid duplicado ───────────
  -- Otimização de desempenho: evita UPSERT conversation desnecessário
  -- para duplicatas óbvias (webhook repetido após 200 perdido, retry da Meta).
  -- NÃO substitui a proteção da UNIQUE(instance_id, meta_message_id) abaixo;
  -- apenas evita trabalho extra no caminho quente de retry.
  SELECT mm.conversation_id,
         mm.id
    INTO v_conversation_id,
         v_message_id
    FROM public.meta_messages mm
   WHERE mm.instance_id     = p_instance_id
     AND mm.meta_message_id = p_meta_message_id;

  IF FOUND THEN
    -- Duplicata confirmada: não reinsere a mensagem. A resolução de lead é idempotente.
    PERFORM public.resolve_meta_conversation_lead(
      p_company_id,
      p_instance_id,
      v_conversation_id,
      p_wa_id,
      p_contact_name
    );

    RETURN jsonb_build_object(
      'created',         false,
      'conversation_id', v_conversation_id,
      'message_id',      v_message_id
    );
  END IF;

  -- ── 4. Criar ou localizar a conversa ─────────────────────────────────────
  -- UPSERT por UNIQUE(company_id, instance_id, wa_id).
  -- Nova conversa: inicia com unread_count=0, last_message_at/preview NULL.
  --   Os valores reais serão definidos na etapa 6 (após inserir a mensagem).
  -- Conversa existente (ON CONFLICT):
  --   - contact_name: atualizado SOMENTE se fornecido (COALESCE preserva
  --     o nome existente quando p_contact_name IS NULL).
  --   - unread_count, last_message_at, last_message_preview: NÃO alterados
  --     aqui — apenas o INSERT vencedor (etapa 5+6) incrementa unread.
  --   - O trigger mc_update_updated_at mantém updated_at automaticamente.
  -- Garantia contra race condition: dois webhooks concorrentes fazem UPSERT
  -- na mesma linha por (company_id, instance_id, wa_id) — ambos idempotentes.
  -- Preparação antes do lock implícito do UPSERT.
  -- A leitura do nome não pede lock de linha.
  SELECT mc.contact_name
    INTO v_existing_contact_name
    FROM public.meta_conversations AS mc
   WHERE mc.company_id = p_company_id
     AND mc.instance_id = p_instance_id
     AND mc.wa_id = p_wa_id;

  SELECT prepared.prepared_decision, prepared.prepared_lead_id
    INTO v_decision, v_prepared_lead_id
    FROM public.acquire_meta_lead_phone_locks(
      p_company_id,
      p_wa_id
    ) AS prepared;

  IF v_decision = 'needs_create' THEN
    SELECT created.outcome, created.conversation_id
      INTO v_decision, v_conversation_id
      FROM private.create_and_link_meta_conversation_lead(
        p_company_id,
        p_instance_id,
        p_wa_id,
        COALESCE(p_contact_name, v_existing_contact_name)
      ) AS created;

    IF v_decision IS DISTINCT FROM 'created_and_linked' THEN
      -- O id devolvido pela subtransação revertida não identifica a conversa.
      v_conversation_id := NULL;
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

      IF NOT EXISTS (
        SELECT 1
          FROM public.meta_conversations AS persisted
         WHERE persisted.id = v_conversation_id
           AND persisted.company_id = p_company_id
           AND persisted.instance_id = p_instance_id
           AND persisted.wa_id = p_wa_id
      ) THEN
        RAISE EXCEPTION 'identidade Meta divergente'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
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

    IF v_decision = 'link_existing' THEN
      v_decision := private.apply_meta_prepared_conversation_lead(
        p_company_id,
        p_instance_id,
        v_conversation_id,
        p_wa_id,
        v_decision,
        v_prepared_lead_id
      );
    END IF;
  END IF;


  -- ── 5. Inserir mensagem ───────────────────────────────────────────────────
  -- direction='inbound' e message_type='text' são definidos internamente:
  -- o caller não decide esses valores em MVP3A.
  --
  -- ON CONFLICT (instance_id, meta_message_id) DO NOTHING:
  --   Proteção final e autoritativa contra wamid duplicado.
  --   Se dois webhooks chegarem concorrentemente com o mesmo wamid:
  --     - Ambos passaram pela verificação antecipada (etapa 3) sem encontrar duplicata.
  --     - Ambos fizeram UPSERT na conversa (idempotente, sem unread).
  --     - O banco garante que apenas UM INSERT vence pela UNIQUE constraint.
  --     - O perdedor obtém v_message_id = NULL → não incrementa unread (etapa 6).
  --   Resultado: exatamente um incremento de unread por wamid. ✅
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

  -- ── 5b. Race condition: recuperar IDs reais da mensagem vencedora ────────
  -- Se DO NOTHING disparou (INSERT perdeu a corrida para webhook concorrente
  -- com o mesmo wamid), v_message_id é NULL.
  -- Recuperamos os IDs reais da mensagem já existente para tornar o retorno
  -- idêntico ao do early check (etapa 3): created=false com IDs concretos.
  -- Retorno antecipado: não incrementa unread, não atualiza stats.
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

  -- ── 6. Atualizar estatísticas da conversa ─────────────────────────────────
  -- Alcançado SOMENTE quando INSERT venceu (v_message_id IS NOT NULL pós-INSERT).
  -- Os caminhos de duplicata (etapa 3 e etapa 5b) retornam antes de chegar aqui.
  -- Garantia de exatamente-uma-vez no incremento de unread. ✅
  --
  -- Regra anti-regressão para last_message_at e last_message_preview:
  --
  -- Caso A — p_provider_timestamp IS NOT NULL:
  --   Avança last_message_at e atualiza preview SOMENTE se:
  --     last_message_at IS NULL (primeira mensagem da conversa)
  --     OU p_provider_timestamp >= last_message_at (mensagem mais recente)
  --   Mensagem atrasada (timestamp antigo) é silenciada: não altera ordenação
  --   nem preview. meta_messages.provider_timestamp permanece com o valor real.
  --
  -- Caso B — p_provider_timestamp IS NULL:
  --   Se last_message_at IS NULL → usar now() como fallback operacional e
  --     atualizar preview (primeira mensagem sem timestamp).
  --   Se last_message_at IS NOT NULL → preservar ambos (last_message_at e
  --     preview existentes). Mensagem sem timestamp não sobrescreve ordenação
  --     de conversa cujo timestamp Meta é conhecido.
  --   meta_messages.provider_timestamp permanece NULL conforme inserido.
  --
  -- preview e last_message_at usam exatamente o mesmo critério:
  --   são atualizados juntos ou nenhum dos dois.
  --   Truncado em 100 caracteres (padrão do projeto).
  --
  -- contact_name:
  --   COALESCE(p_contact_name, contact_name): nunca apaga nome existente.
  --
  -- updated_at: mantido pelo trigger mc_update_updated_at (BEFORE UPDATE).

  UPDATE public.meta_conversations SET
    unread_count         = unread_count + 1,

    last_message_at      = CASE
                             -- Caso A: timestamp conhecido — avança se for mais recente
                             WHEN p_provider_timestamp IS NOT NULL
                                  AND (last_message_at IS NULL
                                       OR p_provider_timestamp >= last_message_at)
                               THEN p_provider_timestamp
                             -- Caso B: sem timestamp — fallback now() apenas na 1ª mensagem
                             WHEN p_provider_timestamp IS NULL
                                  AND last_message_at IS NULL
                               THEN now()
                             -- Demais casos: preservar valor atual
                             ELSE last_message_at
                           END,

    last_message_preview = CASE
                             -- Caso A: mesma condição de last_message_at
                             WHEN p_provider_timestamp IS NOT NULL
                                  AND (last_message_at IS NULL
                                       OR p_provider_timestamp >= last_message_at)
                               THEN LEFT(p_body, 100)
                             -- Caso B: fallback apenas na 1ª mensagem
                             WHEN p_provider_timestamp IS NULL
                                  AND last_message_at IS NULL
                               THEN LEFT(p_body, 100)
                             -- Demais casos: preservar preview atual
                             ELSE last_message_preview
                           END,

    contact_name         = COALESCE(p_contact_name, contact_name)
  WHERE id = v_conversation_id;

  -- ── 7. Retorno ─────────────────────────────────────────────────────────────
  -- Alcançado apenas pelo INSERT vencedor (created=true).
  -- Duplicatas retornam antes (etapas 3 e 5b) com created=false.
  -- Sem PII no retorno: body, wa_id, contact_name não são retornados.

  RETURN jsonb_build_object(
    'created',         true,
    'conversation_id', v_conversation_id,
    'message_id',      v_message_id
  );

END;
$$;

-- =============================================================================
-- COMMENT
-- =============================================================================

COMMENT ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) IS
'Processa atomicamente uma mensagem inbound TEXT do Meta WhatsApp Cloud API (MVP3A). '
'Cria ou localiza a conversa (meta_conversations), insere a mensagem (meta_messages) '
'e atualiza unread_count/last_message_at/preview. '
'Idempotente: wamid duplicado retorna created=false com IDs reais (early check ou race recovery). '
'Race condition: ON CONFLICT DO NOTHING + retorno antecipado garantem exatamente um incremento de unread. '
'Timestamp anti-regressão: mensagem sem ts ou atrasada não sobrescreve last_message_at conhecido. '
'Acesso exclusivo de service_role (backend Vercel). '
'Autorização do usuário deve ocorrer ANTES no backend.';

-- =============================================================================
-- GRANTS / REVOKES
-- =============================================================================

-- Assinatura completa obrigatória (padrão do projeto).
-- Previne ambiguidade se overloads futuros forem adicionados.

REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM anon;

REVOKE ALL ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.process_meta_inbound_message(
  UUID, UUID, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO service_role;

-- =============================================================================
-- Inbound mídia: mesma assinatura. O retry anterior ao UPSERT chama resolve.
-- =============================================================================

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
  v_conversation_id       UUID;
  v_message_id            UUID;
  v_asset_file_type       TEXT;
  v_preview               TEXT;
  v_existing_contact_name TEXT;
  v_decision              TEXT;
  v_prepared_lead_id      INTEGER;
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
  -- 'sticker', 'interactive' e outros continuam rejeitados.
  IF p_message_type NOT IN ('document', 'image', 'video', 'audio') THEN
    RAISE EXCEPTION
      'p_message_type inválido: %. Permitido: document, image, video, audio',
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
    PERFORM public.resolve_meta_conversation_lead(
      p_company_id,
      p_instance_id,
      v_conversation_id,
      p_wa_id,
      p_contact_name
    );

    RETURN jsonb_build_object(
      'created',         false,
      'conversation_id', v_conversation_id,
      'message_id',      v_message_id
    );
  END IF;

  -- ── 5. Criar ou localizar a conversa ──────────────────────────────────────
  -- Chave canônica: (company_id, instance_id, wa_id).
  -- contact_name: COALESCE preserva nome existente se o novo for NULL.
  -- Preparação antes do lock implícito do UPSERT.
  -- A leitura do nome não pede lock de linha.
  SELECT mc.contact_name
    INTO v_existing_contact_name
    FROM public.meta_conversations AS mc
   WHERE mc.company_id = p_company_id
     AND mc.instance_id = p_instance_id
     AND mc.wa_id = p_wa_id;

  SELECT prepared.prepared_decision, prepared.prepared_lead_id
    INTO v_decision, v_prepared_lead_id
    FROM public.acquire_meta_lead_phone_locks(
      p_company_id,
      p_wa_id
    ) AS prepared;

  IF v_decision = 'needs_create' THEN
    SELECT created.outcome, created.conversation_id
      INTO v_decision, v_conversation_id
      FROM private.create_and_link_meta_conversation_lead(
        p_company_id,
        p_instance_id,
        p_wa_id,
        COALESCE(p_contact_name, v_existing_contact_name)
      ) AS created;

    IF v_decision IS DISTINCT FROM 'created_and_linked' THEN
      -- O id devolvido pela subtransação revertida não identifica a conversa.
      v_conversation_id := NULL;
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

      IF NOT EXISTS (
        SELECT 1
          FROM public.meta_conversations AS persisted
         WHERE persisted.id = v_conversation_id
           AND persisted.company_id = p_company_id
           AND persisted.instance_id = p_instance_id
           AND persisted.wa_id = p_wa_id
      ) THEN
        RAISE EXCEPTION 'identidade Meta divergente'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  ELSE
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

    IF v_decision = 'link_existing' THEN
      v_decision := private.apply_meta_prepared_conversation_lead(
        p_company_id,
        p_instance_id,
        v_conversation_id,
        p_wa_id,
        v_decision,
        v_prepared_lead_id
      );
    END IF;
  END IF;


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
    WHEN 'audio'    THEN 'Áudio'
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


-- =============================================================================
-- COMMENT
-- =============================================================================

COMMENT ON FUNCTION public.process_meta_inbound_media_message(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, TEXT
) IS
'Processa atomicamente uma mensagem inbound de MÍDIA (document/image/video/audio) do '
'Meta WhatsApp Cloud API (MVP5.B3.2). '
'Pré-requisito: asset já persistido em company_media_library pelo backend. '
'Valida instância Meta ativa, asset (company + file_type), e persiste meta_messages '
'com body=NULL e media_asset_id. '
'Idempotente: wamid duplicado retorna created=false (early check ou race recovery). '
'O retry anterior ao UPSERT resolve o lead; depois do UPSERT só aplica a preparação. '
'Preview determinístico: Documento/Imagem/Vídeo/Áudio em last_message_preview. '
'Timestamp anti-regressão: mensagem atrasada não sobrescreve last_message_at. '
'Acesso exclusivo de service_role (backend Vercel). '
'Autorização do usuário deve ocorrer ANTES no backend.';


-- =============================================================================
-- GRANTS / REVOKES — mesmo contrato de 20260924112100 (sem ampliar)
-- =============================================================================

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
