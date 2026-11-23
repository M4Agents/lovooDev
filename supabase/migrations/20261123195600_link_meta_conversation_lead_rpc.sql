-- =============================================================================
-- META-L1.4C.2D.2 — vínculo transacional de lead em conversa Meta
-- Timestamp: 20261123195600
--
-- Cria a RPC de vinculação manual. Não altera tabela, trigger, policy nem
-- GRANT de objeto já existente.
--
-- NÃO APLICAR neste passo. DEV e PROD compartilham o mesmo projeto Supabase.
-- A função fica inerte até um endpoint chamá-la.
--
-- Chamada: service_role via public.link_meta_conversation_lead.
-- auth.uid() não é usado: sob service_role ele vem nulo.
-- Papel e access path não são parâmetros. A função relê company_users.
--
-- SQLSTATE internos, distintos de 23503/23514 dos triggers e de 40P01:
--   LM001 — o lead_id da conversa mudou dentro da tentativa. Só esse código
--           é capturado, e apenas para reiniciar a subtransação dos leads.
--   LM002 — parent_company_id mudou antes dos locks definitivos. Só esse
--           código reinicia a escolha da ordem entre pai e filha.
--   LM003 — conversa aponta para um lead cuja linha não existe. Propaga.
--   40001 — três tentativas sem conjunto estável, ou o UPDATE condicional
--           não afetou a linha já travada. Propaga. 40P01 não é capturado.
-- =============================================================================

GRANT USAGE ON SCHEMA private TO service_role;

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

      UPDATE public.meta_conversations AS mc
         SET lead_id = p_destination_lead_id
       WHERE mc.id = p_conversation_id
         AND mc.company_id = p_company_id
         AND mc.status = 'active'
         AND mc.lead_id IS NOT DISTINCT FROM p_expected_lead_id;

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

COMMENT ON FUNCTION private.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid) IS
  'Vincula meta_conversations.lead_id com CAS e revalidação transacional. '
  'SECURITY INVOKER. search_path = pg_catalog. Não lê permissions nem auth.uid(). '
  'LM001 reinicia só a tentativa. LM003 e 40001 propagam. 40P01 não é capturado. '
  'Sucesso: linked ou already_linked com os ids. Falha de negócio: not_found, '
  'forbidden ou conflict, com ids nulos.';

ALTER FUNCTION private.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION private.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.link_meta_conversation_lead(
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
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog
AS $fn$
  SELECT result_code, conversation_id, lead_id
    FROM private.link_meta_conversation_lead(
      p_company_id,
      p_conversation_id,
      p_destination_lead_id,
      p_expected_lead_id,
      p_actor_user_id
    );
$fn$;

COMMENT ON FUNCTION public.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid) IS
  'Wrapper PostgREST. Só encaminha os cinco argumentos para '
  'private.link_meta_conversation_lead. SECURITY INVOKER. EXECUTE apenas service_role.';

ALTER FUNCTION public.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  OWNER TO postgres;

REVOKE ALL ON FUNCTION public.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_meta_conversation_lead(uuid, uuid, integer, integer, uuid)
  TO service_role;
