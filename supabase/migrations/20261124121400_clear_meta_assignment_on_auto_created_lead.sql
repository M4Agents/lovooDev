-- =============================================================================
-- Meta WhatsApp — limpa a atribuição ao criar e vincular um lead sem responsável
--
-- private.create_and_link_meta_conversation_lead grava assigned_to = NULL na
-- mesma sentença que estabelece lead_id. O novo lead continua com
-- responsible_user_id nulo. Falha de duplicidade, funil ou vínculo concorrente
-- desfaz o bloco antes de confirmar essa sentença.
--
-- Não altera vinculação a lead existente, vinculação manual, relink,
-- sincronização de responsável, Uazapi, RLS nem privilégios.
-- =============================================================================

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
       SET lead_id = v_new_id,
           assigned_to = NULL
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

ALTER FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text)
  OWNER TO postgres;

COMMENT ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) IS
  'Cria o lead Meta e tenta vinculá-lo na mesma subtransação. '
  'MC001 desfaz o lead quando o vínculo manual já venceu. '
  'MC002 e MC003 desfazem a criação e preservam a mensagem. '
  'Não é concedida a service_role, authenticated nem anon.';

REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION private.create_and_link_meta_conversation_lead(uuid, uuid, text, text) FROM service_role;
