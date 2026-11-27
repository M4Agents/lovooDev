-- =============================================================================
-- Meta WhatsApp — atribuição inicial da conversa (META-L1.4C.5.1E.1E)
--
-- Preenche assigned_to no primeiro vínculo e no relink autorizado.
-- A leitura do responsável do lead de destino ocorre depois do lock dos leads
-- e antes do lock da conversa. Repetir o mesmo lead não redefine assigned_to.
-- Lead criado sem responsável permanece sem atribuição.
--
-- Não altera o trigger de sincronização, funções Uazapi, RLS nem privilégios.
-- =============================================================================

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
  v_conv              public.meta_conversations%ROWTYPE;
  v_instance_ok       boolean;
  v_linked_id         integer;
  v_initial_assignee  uuid;
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

  -- O chamador já segurou o lead. A membership é lida antes da conversa
  -- para não inverter a ordem da FK ON DELETE SET NULL.
  SELECT l.responsible_user_id
    INTO v_initial_assignee
    FROM public.leads AS l
   WHERE l.id = p_lead_id
     AND l.company_id = p_company_id
     AND l.deleted_at IS NULL
     AND l.responsible_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.company_users AS cu
        WHERE cu.company_id = l.company_id
          AND cu.user_id = l.responsible_user_id
          AND cu.is_active IS TRUE
     );

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
     SET lead_id = p_lead_id,
         assigned_to = v_initial_assignee
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

ALTER FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer)
  OWNER TO postgres;

COMMENT ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) IS
  'Vincula somente o lead já bloqueado pela preparação. '
  'No primeiro vínculo, copia o responsável ativo da mesma empresa ou NULL. '
  'Não cria, não exclui e não substitui vínculo existente.';

REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM authenticated;
REVOKE ALL ON FUNCTION private.apply_meta_prepared_conversation_lead(uuid, uuid, uuid, text, text, integer) FROM service_role;

CREATE OR REPLACE FUNCTION private.link_meta_conversation_lead(
  p_company_id uuid,
  p_conversation_id uuid,
  p_destination_lead_id integer,
  p_expected_lead_id integer,
  p_actor_user_id uuid
)
RETURNS TABLE (
  result_code text,
  conversation_id uuid,
  lead_id integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
DECLARE
  v_restrict boolean;
  v_meta_on boolean;
  v_parent_id uuid;
  v_parent_guess uuid;
  v_lock_attempt integer := 0;
  v_direct_role text;
  v_parent_role text;
  v_role text;
  v_scope_own boolean;
  v_attempt integer := 0;
  v_observed integer;
  v_current integer;
  v_status text;
  v_lead_id integer;
  v_dest_company uuid;
  v_dest_deleted timestamptz;
  v_dest_owner uuid;
  v_cur_company uuid;
  v_updated integer;
  v_code text;
  v_initial_assignee uuid;
  v_relink_assignee uuid;
BEGIN
  IF p_company_id IS NULL
     OR p_conversation_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_destination_lead_id IS NULL
     OR p_destination_lead_id <= 0
     OR (p_expected_lead_id IS NOT NULL AND p_expected_lead_id <= 0)
  THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  SELECT c.parent_company_id
    INTO v_parent_guess
    FROM public.companies AS c
   WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  -- Filha em FOR UPDATE desde o início: a FK imediata de company_users espera
  -- esse lock, então um INSERT de membership não confirma no meio da decisão.
  -- Pai em FOR SHARE, sempre na ordem crescente de UUID. Sem upgrade de lock.
  LOOP
    v_lock_attempt := v_lock_attempt + 1;
    IF v_lock_attempt > 3 THEN
      RAISE EXCEPTION 'link_meta_conversation_lead: hierarquia instável'
        USING ERRCODE = '40001';
    END IF;

    BEGIN
      IF v_parent_guess IS NULL OR v_parent_guess = p_company_id THEN
        SELECT c.restrict_leads_to_owner, c.meta_whatsapp_enabled, c.parent_company_id
          INTO v_restrict, v_meta_on, v_parent_id
          FROM public.companies AS c
         WHERE c.id = p_company_id
         FOR UPDATE;
      ELSIF v_parent_guess < p_company_id THEN
        PERFORM 1
          FROM public.companies AS parent
         WHERE parent.id = v_parent_guess
         FOR SHARE;
        SELECT c.restrict_leads_to_owner, c.meta_whatsapp_enabled, c.parent_company_id
          INTO v_restrict, v_meta_on, v_parent_id
          FROM public.companies AS c
         WHERE c.id = p_company_id
         FOR UPDATE;
      ELSE
        SELECT c.restrict_leads_to_owner, c.meta_whatsapp_enabled, c.parent_company_id
          INTO v_restrict, v_meta_on, v_parent_id
          FROM public.companies AS c
         WHERE c.id = p_company_id
         FOR UPDATE;
        IF NOT FOUND THEN
          RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::integer;
          RETURN;
        END IF;
        PERFORM 1
          FROM public.companies AS parent
         WHERE parent.id = v_parent_guess
         FOR SHARE;
      END IF;

      IF NOT FOUND AND (v_parent_guess IS NULL OR v_parent_guess = p_company_id OR v_parent_guess < p_company_id) THEN
        RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::integer;
        RETURN;
      END IF;

      IF v_parent_id IS DISTINCT FROM v_parent_guess THEN
        RAISE EXCEPTION 'link_meta_conversation_lead: reordenar empresas'
          USING ERRCODE = 'LM002';
      END IF;

      EXIT;
    EXCEPTION
      WHEN SQLSTATE 'LM002' THEN
        NULL;
    END;

    SELECT c.parent_company_id
      INTO v_parent_guess
      FROM public.companies AS c
     WHERE c.id = p_company_id;

    IF NOT FOUND THEN
      RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::integer;
      RETURN;
    END IF;
  END LOOP;

  IF v_meta_on IS NOT TRUE THEN
    RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  -- Memberships do ator, ativas ou inativas, em ordem de company_id.
  IF v_parent_id IS NULL OR v_parent_id = p_company_id THEN
    PERFORM 1
      FROM public.company_users AS cu
     WHERE cu.user_id = p_actor_user_id
       AND cu.company_id = p_company_id
     FOR SHARE;
  ELSIF v_parent_id < p_company_id THEN
    PERFORM 1
      FROM public.company_users AS cu
     WHERE cu.user_id = p_actor_user_id
       AND cu.company_id = v_parent_id
     FOR SHARE;
    PERFORM 1
      FROM public.company_users AS cu
     WHERE cu.user_id = p_actor_user_id
       AND cu.company_id = p_company_id
     FOR SHARE;
  ELSE
    PERFORM 1
      FROM public.company_users AS cu
     WHERE cu.user_id = p_actor_user_id
       AND cu.company_id = p_company_id
     FOR SHARE;
    PERFORM 1
      FROM public.company_users AS cu
     WHERE cu.user_id = p_actor_user_id
       AND cu.company_id = v_parent_id
     FOR SHARE;
  END IF;

  SELECT cu.role
    INTO v_direct_role
    FROM public.company_users AS cu
   WHERE cu.user_id = p_actor_user_id
     AND cu.company_id = p_company_id
     AND cu.is_active IS TRUE;

  IF FOUND THEN
    IF v_direct_role NOT IN (
      'super_admin', 'system_admin', 'partner', 'admin', 'manager', 'seller'
    ) THEN
      RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::integer;
      RETURN;
    END IF;

    IF v_direct_role = 'partner' THEN
      PERFORM 1
        FROM public.partner_company_assignments AS pca
       WHERE pca.partner_user_id = p_actor_user_id
         AND pca.company_id = p_company_id
       FOR SHARE;

      IF NOT EXISTS (
        SELECT 1
          FROM public.partner_company_assignments AS pca
         WHERE pca.partner_user_id = p_actor_user_id
           AND pca.company_id = p_company_id
           AND pca.is_active IS TRUE
      ) THEN
        RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::integer;
        RETURN;
      END IF;
    END IF;

    v_role := v_direct_role;
  ELSE
    v_role := NULL;
    v_parent_role := NULL;

    IF v_parent_id IS NOT NULL THEN
      PERFORM 1
        FROM public.company_users AS cu
        JOIN public.companies AS parent
          ON parent.id = cu.company_id
       WHERE cu.user_id = p_actor_user_id
         AND cu.company_id = v_parent_id
         AND cu.is_active IS TRUE
         AND cu.role = 'partner'
         AND parent.company_type = 'parent';

      IF FOUND THEN
        PERFORM 1
          FROM public.partner_company_assignments AS pca
         WHERE pca.partner_user_id = p_actor_user_id
           AND pca.company_id = p_company_id
         FOR SHARE;

        IF EXISTS (
          SELECT 1
            FROM public.partner_company_assignments AS pca
           WHERE pca.partner_user_id = p_actor_user_id
             AND pca.company_id = p_company_id
             AND pca.is_active IS TRUE
        ) THEN
          v_role := 'partner';
        END IF;
      END IF;
    END IF;

    IF v_role IS NULL AND v_parent_id IS NOT NULL THEN
      SELECT cu.role
        INTO v_parent_role
        FROM public.company_users AS cu
        JOIN public.companies AS parent
          ON parent.id = cu.company_id
       WHERE cu.user_id = p_actor_user_id
         AND cu.company_id = v_parent_id
         AND cu.is_active IS TRUE
         AND cu.role IN ('super_admin', 'system_admin')
         AND parent.company_type = 'parent';

      IF v_parent_role IS NOT NULL THEN
        v_role := v_parent_role;
      END IF;
    END IF;

    IF v_role IS NULL THEN
      RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::integer;
      RETURN;
    END IF;
  END IF;

  -- Seller restrito é o único escopo own. Nenhum template JSONB entra na decisão.
  v_scope_own := v_role = 'seller' AND v_restrict IS TRUE;

  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 3 THEN
      RAISE EXCEPTION 'link_meta_conversation_lead: conjunto de leads instável'
        USING ERRCODE = '40001';
    END IF;

    BEGIN
      SELECT mc.lead_id
        INTO v_observed
        FROM public.meta_conversations AS mc
       WHERE mc.id = p_conversation_id
         AND mc.company_id = p_company_id;

      FOR v_lead_id IN
        SELECT s.lead_id
          FROM (
            SELECT p_destination_lead_id AS lead_id
            UNION
            SELECT v_observed
          ) AS s
         WHERE s.lead_id IS NOT NULL
         ORDER BY s.lead_id
      LOOP
        PERFORM 1
          FROM public.leads AS l
         WHERE l.id = v_lead_id
         FOR NO KEY UPDATE;
      END LOOP;

      v_initial_assignee := NULL;
      v_relink_assignee := NULL;
      IF v_observed IS NULL
         OR v_observed IS DISTINCT FROM p_destination_lead_id
      THEN
        IF v_observed IS NULL THEN
          SELECT l.responsible_user_id
            INTO v_initial_assignee
            FROM public.leads AS l
           WHERE l.id = p_destination_lead_id
             AND l.company_id = p_company_id
             AND l.deleted_at IS NULL
             AND l.responsible_user_id IS NOT NULL
             AND EXISTS (
               SELECT 1
                 FROM public.company_users AS cu
                WHERE cu.company_id = l.company_id
                  AND cu.user_id = l.responsible_user_id
                  AND cu.is_active IS TRUE
             );
        ELSE
          SELECT l.responsible_user_id
            INTO v_relink_assignee
            FROM public.leads AS l
           WHERE l.id = p_destination_lead_id
             AND l.company_id = p_company_id
             AND l.deleted_at IS NULL
             AND l.responsible_user_id IS NOT NULL
             AND EXISTS (
               SELECT 1
                 FROM public.company_users AS cu
                WHERE cu.company_id = l.company_id
                  AND cu.user_id = l.responsible_user_id
                  AND cu.is_active IS TRUE
             );
        END IF;
      END IF;

      SELECT mc.lead_id, mc.status
        INTO v_current, v_status
        FROM public.meta_conversations AS mc
       WHERE mc.id = p_conversation_id
         AND mc.company_id = p_company_id
       FOR UPDATE;

      IF NOT FOUND OR v_status IS DISTINCT FROM 'active' THEN
        RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::integer;
        RETURN;
      END IF;

      IF v_current IS DISTINCT FROM v_observed THEN
        RAISE EXCEPTION 'link_meta_conversation_lead: expandir conjunto'
          USING ERRCODE = 'LM001';
      END IF;

      SELECT l.company_id, l.deleted_at, l.responsible_user_id
        INTO v_dest_company, v_dest_deleted, v_dest_owner
        FROM public.leads AS l
       WHERE l.id = p_destination_lead_id;

      IF NOT FOUND
         OR v_dest_company IS DISTINCT FROM p_company_id
         OR v_dest_deleted IS NOT NULL
         OR (v_scope_own AND v_dest_owner IS DISTINCT FROM p_actor_user_id)
      THEN
        RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::integer;
        RETURN;
      END IF;

      IF v_current IS NOT NULL AND v_current IS DISTINCT FROM p_destination_lead_id THEN
        IF v_role NOT IN ('super_admin', 'system_admin', 'admin') THEN
          RETURN QUERY SELECT 'forbidden'::text, NULL::uuid, NULL::integer;
          RETURN;
        END IF;

        SELECT l.company_id
          INTO v_cur_company
          FROM public.leads AS l
         WHERE l.id = v_current;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'link_meta_current_lead_missing'
            USING ERRCODE = 'LM003';
        END IF;

        IF v_cur_company IS DISTINCT FROM p_company_id THEN
          RETURN QUERY SELECT 'not_found'::text, NULL::uuid, NULL::integer;
          RETURN;
        END IF;
        -- deleted_at do lead atual não bloqueia replace destes papéis.
      END IF;

      IF v_current IS DISTINCT FROM p_expected_lead_id THEN
        RETURN QUERY SELECT 'conflict'::text, NULL::uuid, NULL::integer;
        RETURN;
      END IF;

      IF v_current IS NULL THEN
        UPDATE public.meta_conversations AS mc
           SET lead_id = p_destination_lead_id,
               assigned_to = v_initial_assignee
         WHERE mc.id = p_conversation_id
           AND mc.company_id = p_company_id
           AND mc.status = 'active'
           AND mc.lead_id IS NOT DISTINCT FROM p_expected_lead_id;
      ELSIF v_current IS DISTINCT FROM p_destination_lead_id THEN
        UPDATE public.meta_conversations AS mc
           SET lead_id = p_destination_lead_id,
               assigned_to = v_relink_assignee
         WHERE mc.id = p_conversation_id
           AND mc.company_id = p_company_id
           AND mc.status = 'active'
           AND mc.lead_id IS NOT DISTINCT FROM p_expected_lead_id;
      ELSE
        UPDATE public.meta_conversations AS mc
           SET lead_id = p_destination_lead_id
         WHERE mc.id = p_conversation_id
           AND mc.company_id = p_company_id
           AND mc.status = 'active'
           AND mc.lead_id IS NOT DISTINCT FROM p_expected_lead_id;
      END IF;

      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated <> 1 THEN
        RAISE EXCEPTION 'link_meta_cas_lost'
          USING ERRCODE = '40001';
      END IF;

      IF v_current IS NOT DISTINCT FROM p_destination_lead_id THEN
        v_code := 'already_linked';
      ELSE
        v_code := 'linked';
      END IF;

      RETURN QUERY
      SELECT v_code, p_conversation_id, p_destination_lead_id;
      RETURN;
    EXCEPTION
      WHEN SQLSTATE 'LM001' THEN
        NULL;
    END;
  END LOOP;
END;
$fn$;

ALTER FUNCTION private.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  OWNER TO postgres;

COMMENT ON FUNCTION private.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid) IS
  'Vincula meta_conversations.lead_id com CAS e revalidação transacional. '
  'No primeiro vínculo e no relink, copia o responsável ativo do lead de destino ou NULL. '
  'Repetir o mesmo lead não altera assigned_to. '
  'SECURITY INVOKER. search_path = pg_catalog. Não lê permissions nem auth.uid(). '
  'LM001 reinicia só a tentativa. LM003 e 40001 propagam. 40P01 não é capturado. '
  'Sucesso: linked ou already_linked com os ids. Falha de negócio: not_found, '
  'forbidden ou conflict, com ids nulos.';

REVOKE ALL ON FUNCTION private.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  TO service_role;
