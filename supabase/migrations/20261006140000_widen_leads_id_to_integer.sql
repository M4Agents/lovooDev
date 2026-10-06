-- attempt_marker: widen-leads-id-20261006-1542-b8e1
-- Amplia o id do lead de smallint para integer.
-- Nao altera payload, autenticacao, RLS, company_id nem regras comerciais.
-- Policies que dependem das colunas alteradas sao removidas so para
-- o ALTER TYPE e recriadas do snapshot, com a mesma expressao.
-- Nao usa setval, RESTART, nextval de teste nem DROP CASCADE.
--
-- Executor: uma sessao nova, um script, sem transacao ja aberta.
-- lock_timeout = 5s limita cada espera de lock posterior ao bloco NOWAIT.
-- Os locks iniciais usam NOWAIT e falham na hora. 5s nao vira 180s:
-- uma espera posterior longa seguraria a transacao sem avancao.
-- statement_timeout = 180s limita cada comando, nao a soma da transacao.
-- O relogio de 180s comeca no envio desta execucao.
-- A segunda sessao grava pid e backend_start da linha cujo query
-- contem o attempt_marker. Cancela somente se esses dois valores
-- e o marcador ainda coincidirem e state = active.
-- Se a sessao ja tiver feito COMMIT, nao cancelar: conferir o resultado.
-- O cancelamento pede a interrupcao; o rollback pode continuar depois.
-- Se esta sessao ficar idle in transaction, pg_terminate_backend
-- somente neste pid e neste backend_start.
-- Em qualquer erro: ROLLBACK e encerrar esta sessao. Sem retry automatico.
-- Nao encerrar sessoes de outros usuarios.
--
-- A primeira aplicacao (2026-10-06 15:00:52Z, pid 1455468) fez ROLLBACK
-- por deadlock 40P01. Ela bloqueou public.leads e depois esperou
-- AccessExclusive em public.lead_activities (oid 327831) e
-- public.lead_tag_assignments (oid 208827). Sessoes authenticator
-- ja tinham essas filhas e esperavam AccessShare em leads (oid 182061).
-- O bloco abaixo pede todos os locks de relacao antes de DROP ou ALTER.
-- NOWAIT nao cobre lock de funcao, catalogo, TOAST ou da sequence,
-- adquiridos mais adiante. deadlock_timeout (~1s) continua mais curto
-- que lock_timeout, entao uma espera circular posterior ainda pode
-- terminar em 40P01 e rollback.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '180s';
SET LOCAL search_path = public;

-- ACCESS EXCLUSIVE NOWAIT, em ordem alfabetica de relname, antes de
-- qualquer DROP ou ALTER. Falha em um nome: a transacao aborta, nada
-- permanece alterado, e a mensagem cita a relacao ocupada.
-- A view chat_conversations_with_leads depende de chat_conversations,
-- leads e chat_contacts. As duas primeiras estao nesta lista. A view
-- tambem. chat_contacts nao tem FK para leads; o CREATE VIEW so pede
-- AccessShare nela, compativel com leitura e gravacao comuns, entao
-- ela nao entra no exclusivo. Nenhum objeto depende da view.
DO $locks$
DECLARE
  v_names text[] := ARRAY[
    'automation_executions',
    'chat_conversations',
    'chat_conversations_with_leads',
    'duplicate_notifications',
    'instagram_comments',
    'instagram_conversations',
    'internal_notes',
    'lead_activities',
    'lead_custom_values',
    'lead_entries',
    'lead_import_events',
    'lead_media_unified',
    'lead_merge_history',
    'lead_social_profiles',
    'lead_stage_history',
    'lead_tag_assignments',
    'leads',
    'opportunities',
    'opportunity_funnel_positions',
    'system_notifications',
    'webhook_api_logs',
    'webhook_trigger_logs',
    'whatsapp_instance_lead_funnel_hints'
  ];
  v_missing text;
  v_name text;
BEGIN
  SELECT string_agg(n, ', ' ORDER BY n)
    INTO v_missing
  FROM unnest(v_names) AS n
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace ns ON ns.oid = c.relnamespace
    WHERE ns.nspname = 'public'
      AND c.relname = n
      AND c.relkind IN ('r', 'p', 'v')
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'lock nao adquirido, rollback sem alteracao: relacao ausente: %',
      v_missing;
  END IF;

  FOREACH v_name IN ARRAY v_names
  LOOP
    BEGIN
      EXECUTE format(
        'LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE NOWAIT',
        v_name
      );
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION
          'lock nao adquirido, rollback sem alteracao: public.%',
          v_name
          USING ERRCODE = 'lock_not_available';
    END;
  END LOOP;
END
$locks$;

CREATE TEMP TABLE seq_snapshot ON COMMIT DROP AS
SELECT
  seq.last_value,
  seq.is_called,
  meta.increment_by,
  meta.min_value,
  meta.cycle,
  meta.cache_size,
  meta.start_value
FROM public.leads_id_seq AS seq
CROSS JOIN LATERAL (
  SELECT increment_by, min_value, cycle, cache_size, start_value
  FROM pg_sequences
  WHERE schemaname = 'public'
    AND sequencename = 'leads_id_seq'
) AS meta;

CREATE TEMP TABLE lead_id_snapshot ON COMMIT DROP AS
SELECT
  count(*)::bigint AS n,
  min(id) AS min_id,
  max(id) AS max_id,
  coalesce(sum(id)::bigint, 0) AS sum_id
FROM public.leads;

CREATE TEMP TABLE id_default_snapshot ON COMMIT DROP AS
SELECT pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_attrdef d
JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'leads'
  AND a.attname = 'id';

CREATE TEMP TABLE policy_snapshot ON COMMIT DROP AS
WITH cols AS (
  SELECT c.oid AS relid, a.attnum
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND (
      (c.relname = 'leads' AND a.attname IN ('id', 'duplicate_of_lead_id'))
      OR (c.relname = 'duplicate_notifications' AND a.attname IN ('lead_id', 'duplicate_of_lead_id'))
      OR (c.relname = 'lead_media_unified' AND a.attname = 'lead_id')
      OR (c.relname = 'lead_merge_history' AND a.attname IN ('source_lead_id', 'target_lead_id'))
      OR (c.relname = 'whatsapp_instance_lead_funnel_hints' AND a.attname = 'lead_id')
    )
),
deps AS (
  SELECT DISTINCT d.objid AS pol_oid
  FROM pg_depend d
  JOIN cols ON cols.relid = d.refobjid AND cols.attnum = d.refobjsubid
  WHERE d.classid = 'pg_policy'::regclass
)
SELECT c.relname,
       p.polname,
       p.polcmd::text AS cmd,
       p.polpermissive,
       coalesce((
         SELECT string_agg(
           CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r) END,
           ',' ORDER BY r
         )
         FROM unnest(p.polroles) AS r
       ), '') AS roles,
       pg_get_expr(p.polqual, p.polrelid) AS using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr,
       c.relrowsecurity,
       c.relforcerowsecurity,
       md5(
         c.relname || '|' || p.polname || '|' || p.polcmd::text || '|' ||
         p.polpermissive::text || '|' ||
         coalesce((
           SELECT string_agg(
             CASE WHEN r = 0 THEN 'public' ELSE pg_get_userbyid(r) END,
             ',' ORDER BY r
           )
           FROM unnest(p.polroles) AS r
         ), '') || '|' ||
         coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' ||
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') || '|' ||
         c.relrowsecurity::text || '|' || c.relforcerowsecurity::text
       ) AS fingerprint
FROM deps
JOIN pg_policy p ON p.oid = deps.pol_oid
JOIN pg_class c ON c.oid = p.polrelid;

DO $policy_preflight$
DECLARE
  v_bad text;
BEGIN
  SELECT string_agg(
           coalesce(s.relname, e.relname) || '.' || coalesce(s.polname, e.polname),
           ', ' ORDER BY coalesce(s.relname, e.relname), coalesce(s.polname, e.polname)
         )
    INTO v_bad
  FROM (
    VALUES
      ('lead_custom_values', 'lcv_delete_admin_or_parent_admin', 'c7666200e038a894a746e4b293f5f693'),
      ('lead_custom_values', 'lcv_insert_member_or_parent_admin', '707eb19703ca69dd56e4e126fb09a96c'),
      ('lead_custom_values', 'lcv_select_member_or_parent_admin', '5ba6569ad746925ef637cd50f0f615fd'),
      ('lead_custom_values', 'lcv_update_member_or_parent_admin', 'c9f81bbf1f1784b9172dc66470b1d5cd'),
      ('lead_merge_history', 'lead_merge_history_company_isolation', '887ea9a0636b4cd0d752947dfe6b9026'),
      ('lead_tag_assignments', 'lead_tag_assignments_company_isolation', 'a6aae92ab01f24d6b8537a8b67fe6b7a')
  ) AS e(relname, polname, fingerprint)
  FULL JOIN policy_snapshot s
    ON s.relname = e.relname
   AND s.polname = e.polname
   AND s.fingerprint = e.fingerprint
  WHERE s.polname IS NULL
     OR e.polname IS NULL;

  IF v_bad IS NOT NULL OR (SELECT count(*) FROM policy_snapshot) IS DISTINCT FROM 6 THEN
    RAISE EXCEPTION
      'preflight: policies dependentes divergiram do inventario: %',
      coalesce(v_bad, 'contagem diferente de 6');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM policy_snapshot
    WHERE relrowsecurity IS DISTINCT FROM true
       OR relforcerowsecurity IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'preflight: RLS das tabelas das policies divergiu';
  END IF;
END
$policy_preflight$;

DO $deps$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_depend d
    JOIN pg_rewrite rw ON rw.oid = d.objid
    JOIN pg_class c ON c.oid = rw.ev_class
    WHERE d.refobjid = 'public.chat_conversations_with_leads'::regclass
      AND c.oid <> 'public.chat_conversations_with_leads'::regclass
  ) THEN
    RAISE EXCEPTION 'chat_conversations_with_leads tem dependente; abortando sem CASCADE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_depend d ON d.refobjid = p.oid AND d.deptype = 'n'
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'detect_lead_duplicates',
        'take_whatsapp_instance_lead_funnel_hint',
        'process_retroactive_duplicates',
        'get_leads_for_notifications',
        'get_pending_duplicate_notifications',
        'public_create_tracking_lead'
      )
  ) THEN
    RAISE EXCEPTION 'funcao de id de lead tem dependencia normal; abortando sem CASCADE';
  END IF;
END
$deps$;

DROP VIEW public.chat_conversations_with_leads;

ALTER TABLE public.automation_executions DROP CONSTRAINT automation_executions_lead_id_fkey;
ALTER TABLE public.chat_conversations DROP CONSTRAINT chat_conversations_lead_id_fkey;
ALTER TABLE public.duplicate_notifications DROP CONSTRAINT duplicate_notifications_duplicate_of_lead_id_fkey;
ALTER TABLE public.duplicate_notifications DROP CONSTRAINT duplicate_notifications_lead_id_fkey;
ALTER TABLE public.instagram_comments DROP CONSTRAINT instagram_comments_lead_id_fkey;
ALTER TABLE public.instagram_conversations DROP CONSTRAINT instagram_conversations_lead_id_fkey;
ALTER TABLE public.internal_notes DROP CONSTRAINT internal_notes_lead_id_fkey;
ALTER TABLE public.lead_activities DROP CONSTRAINT lead_activities_lead_id_fkey;
ALTER TABLE public.lead_custom_values DROP CONSTRAINT lead_custom_values_lead_id_fkey;
ALTER TABLE public.lead_entries DROP CONSTRAINT lead_entries_lead_id_fkey;
ALTER TABLE public.lead_import_events DROP CONSTRAINT lead_import_events_lead_id_fkey;
ALTER TABLE public.lead_media_unified DROP CONSTRAINT lead_media_unified_lead_id_fkey;
ALTER TABLE public.lead_social_profiles DROP CONSTRAINT lead_social_profiles_lead_id_fkey;
ALTER TABLE public.lead_stage_history DROP CONSTRAINT lead_stage_history_lead_id_fkey;
ALTER TABLE public.lead_tag_assignments DROP CONSTRAINT lead_tag_assignments_lead_id_fkey;
ALTER TABLE public.opportunities DROP CONSTRAINT opportunities_lead_id_fkey;
ALTER TABLE public.opportunity_funnel_positions DROP CONSTRAINT lead_funnel_positions_lead_id_fkey;
ALTER TABLE public.system_notifications DROP CONSTRAINT system_notifications_lead_id_fkey;
ALTER TABLE public.webhook_api_logs DROP CONSTRAINT webhook_api_logs_lead_id_fkey;
ALTER TABLE public.webhook_trigger_logs DROP CONSTRAINT webhook_trigger_logs_lead_id_fkey;

DROP POLICY lead_tag_assignments_company_isolation ON public.lead_tag_assignments;
DROP POLICY lcv_delete_admin_or_parent_admin ON public.lead_custom_values;
DROP POLICY lcv_insert_member_or_parent_admin ON public.lead_custom_values;
DROP POLICY lcv_select_member_or_parent_admin ON public.lead_custom_values;
DROP POLICY lcv_update_member_or_parent_admin ON public.lead_custom_values;
DROP POLICY lead_merge_history_company_isolation ON public.lead_merge_history;

ALTER TABLE public.leads
  ALTER COLUMN id TYPE integer,
  ALTER COLUMN duplicate_of_lead_id TYPE integer;

ALTER TABLE public.duplicate_notifications
  ALTER COLUMN lead_id TYPE integer,
  ALTER COLUMN duplicate_of_lead_id TYPE integer;

ALTER TABLE public.lead_media_unified
  ALTER COLUMN lead_id TYPE integer;

ALTER TABLE public.lead_merge_history
  ALTER COLUMN source_lead_id TYPE integer,
  ALTER COLUMN target_lead_id TYPE integer;

ALTER TABLE public.whatsapp_instance_lead_funnel_hints
  ALTER COLUMN lead_id TYPE integer;

ALTER SEQUENCE public.leads_id_seq AS integer MAXVALUE 2147483647;

ALTER TABLE public.automation_executions
  ADD CONSTRAINT automation_executions_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.chat_conversations
  ADD CONSTRAINT chat_conversations_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.duplicate_notifications
  ADD CONSTRAINT duplicate_notifications_duplicate_of_lead_id_fkey
  FOREIGN KEY (duplicate_of_lead_id) REFERENCES public.leads(id);

ALTER TABLE public.duplicate_notifications
  ADD CONSTRAINT duplicate_notifications_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id);

ALTER TABLE public.instagram_comments
  ADD CONSTRAINT instagram_comments_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id);

ALTER TABLE public.instagram_conversations
  ADD CONSTRAINT instagram_conversations_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id);

ALTER TABLE public.internal_notes
  ADD CONSTRAINT internal_notes_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_activities
  ADD CONSTRAINT lead_activities_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_custom_values
  ADD CONSTRAINT lead_custom_values_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_entries
  ADD CONSTRAINT lead_entries_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_import_events
  ADD CONSTRAINT lead_import_events_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.lead_media_unified
  ADD CONSTRAINT lead_media_unified_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_social_profiles
  ADD CONSTRAINT lead_social_profiles_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_stage_history
  ADD CONSTRAINT lead_stage_history_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.lead_tag_assignments
  ADD CONSTRAINT lead_tag_assignments_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.opportunities
  ADD CONSTRAINT opportunities_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.opportunity_funnel_positions
  ADD CONSTRAINT lead_funnel_positions_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.system_notifications
  ADD CONSTRAINT system_notifications_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE CASCADE;

ALTER TABLE public.webhook_api_logs
  ADD CONSTRAINT webhook_api_logs_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

ALTER TABLE public.webhook_trigger_logs
  ADD CONSTRAINT webhook_trigger_logs_lead_id_fkey
  FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.detect_lead_duplicates(new_lead_id integer)
 RETURNS TABLE(duplicate_id integer, reason text)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
    lead_record RECORD;
    v_phone_normalized TEXT;
BEGIN
    SELECT * INTO lead_record FROM leads WHERE id = new_lead_id;

    IF lead_record.phone IS NOT NULL AND trim(lead_record.phone) != '' THEN
        v_phone_normalized := public.canonicalize_br_mobile_phone(lead_record.phone);

        IF v_phone_normalized IS NOT NULL AND LENGTH(v_phone_normalized) >= 10 THEN
            FOR duplicate_id, reason IN
                SELECT l.id, 'phone'::TEXT
                FROM leads l
                WHERE l.company_id = lead_record.company_id
                  AND l.id != new_lead_id
                  AND l.deleted_at IS NULL
                  AND l.phone IS NOT NULL
                  AND trim(l.phone) != ''
                  AND (
                    l.phone_normalized = v_phone_normalized
                    OR public.canonicalize_br_mobile_phone(l.phone) = v_phone_normalized
                  )
                LIMIT 1
            LOOP
                RETURN NEXT;
                RETURN;
            END LOOP;
        END IF;
    END IF;

    IF lead_record.email IS NOT NULL AND trim(lead_record.email) != '' THEN
        FOR duplicate_id, reason IN
            SELECT l.id, 'email'::TEXT
            FROM leads l
            WHERE lower(trim(l.email)) = lower(trim(lead_record.email))
              AND l.company_id = lead_record.company_id
              AND l.id != new_lead_id
              AND l.deleted_at IS NULL
              AND l.email IS NOT NULL
              AND trim(l.email) != ''
            LIMIT 1
        LOOP
            RETURN NEXT;
            RETURN;
        END LOOP;
    END IF;

    RETURN;
END;
$function$;

ALTER FUNCTION public.detect_lead_duplicates(integer) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.detect_lead_duplicates(integer) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_lead_duplicates(integer) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_lead_duplicates_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    duplicate_record RECORD;
    notification_id INTEGER;
BEGIN
    -- Executar detecção de duplicatas
    FOR duplicate_record IN
        SELECT * FROM detect_lead_duplicates(NEW.id)
    LOOP
        -- Marcar lead como duplicata
        UPDATE leads
        SET is_duplicate = true,
            duplicate_of_lead_id = duplicate_record.duplicate_id,
            duplicate_reason = duplicate_record.reason,
            duplicate_status = 'pending'
        WHERE id = NEW.id;

        -- Criar notificação
        SELECT create_duplicate_notification(
            NEW.company_id,
            NEW.id,
            duplicate_record.duplicate_id,
            duplicate_record.reason
        ) INTO notification_id;

        -- Log da detecção
        RAISE NOTICE 'Duplicata detectada: Lead % é duplicata de % por % (Notificação: %)',
            NEW.id, duplicate_record.duplicate_id, duplicate_record.reason, notification_id;

        -- Sair do loop (apenas uma duplicata por vez)
        EXIT;
    END LOOP;

    RETURN NEW;
END;
$function$;

ALTER FUNCTION public.check_lead_duplicates_trigger() OWNER TO postgres;

DROP FUNCTION public.detect_lead_duplicates(smallint);

DROP FUNCTION public.process_retroactive_duplicates(uuid);

CREATE FUNCTION public.process_retroactive_duplicates(p_company_id uuid)
 RETURNS TABLE(processed_lead_id integer, duplicate_of_id integer, reason text, notification_created boolean)
 LANGUAGE plpgsql
AS $function$
DECLARE
    lead_record RECORD;
    duplicate_record RECORD;
    notification_id INTEGER;
BEGIN
    FOR lead_record IN
        SELECT * FROM leads
        WHERE company_id = p_company_id
          AND is_duplicate = false
          AND deleted_at IS NULL
        ORDER BY created_at ASC
    LOOP
        FOR duplicate_record IN
            SELECT * FROM detect_lead_duplicates(lead_record.id)
        LOOP
            UPDATE leads
            SET is_duplicate = true,
                duplicate_of_lead_id = duplicate_record.duplicate_id,
                duplicate_reason = duplicate_record.reason,
                duplicate_status = 'pending'
            WHERE id = lead_record.id;

            SELECT create_duplicate_notification(
                p_company_id,
                lead_record.id,
                duplicate_record.duplicate_id,
                duplicate_record.reason
            ) INTO notification_id;

            processed_lead_id := lead_record.id;
            duplicate_of_id := duplicate_record.duplicate_id;
            reason := duplicate_record.reason;
            notification_created := (notification_id IS NOT NULL);

            RETURN NEXT;

            EXIT;
        END LOOP;
    END LOOP;

    RETURN;
END;
$function$;

ALTER FUNCTION public.process_retroactive_duplicates(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.process_retroactive_duplicates(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_retroactive_duplicates(uuid) TO anon, authenticated, service_role;

CREATE FUNCTION public.take_whatsapp_instance_lead_funnel_hint(p_lead_id integer, p_company_id uuid)
 RETURNS TABLE(instance_id uuid, funnel_id uuid, stage_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  DELETE FROM public.whatsapp_instance_lead_funnel_hints h
  WHERE h.lead_id = p_lead_id
    AND h.company_id = p_company_id
  RETURNING h.instance_id, h.funnel_id, h.stage_id;
END;
$function$;

ALTER FUNCTION public.take_whatsapp_instance_lead_funnel_hint(integer, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.take_whatsapp_instance_lead_funnel_hint(integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.take_whatsapp_instance_lead_funnel_hint(integer, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.take_whatsapp_instance_lead_funnel_hint(integer, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.take_whatsapp_instance_lead_funnel_hint(integer, uuid) FROM service_role;

DROP FUNCTION public.take_whatsapp_instance_lead_funnel_hint(smallint, uuid);

CREATE OR REPLACE FUNCTION public.create_lead_from_whatsapp_safe_v9(p_company_id uuid, p_phone text, p_name text DEFAULT NULL::text, p_instance_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_id integer;
  v_opportunity_id uuid;
  v_existing_lead_id integer;
  v_phone_normalized text;
  v_max_leads integer;
  v_current_leads bigint;
  v_is_over_plan boolean := false;
  v_assigned_user_id uuid;
  v_flag boolean := false;
  v_cfg_funnel uuid;
  v_cfg_stage uuid;
  v_funnel_active boolean := false;
  v_stage_belongs boolean := false;
  v_use_hint boolean := false;
  v_funnel_applied text;
  v_fallback_reason text;
  v_out_funnel uuid;
  v_out_stage uuid;
BEGIN
  RAISE LOG 'create_lead_from_whatsapp_safe v9: empresa % telefone % instancia %',
    p_company_id, p_phone, p_instance_id;

  v_phone_normalized := public.canonicalize_br_mobile_phone(p_phone);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'lead_create_wa:' || p_company_id::text || ':' || COALESCE(v_phone_normalized, ''),
      0
    )
  );

  SELECT id INTO v_existing_lead_id
  FROM leads
  WHERE company_id = p_company_id
    AND deleted_at IS NULL
    AND (
      phone_normalized = v_phone_normalized
      OR public.canonicalize_br_mobile_phone(phone) = v_phone_normalized
    )
  LIMIT 1;

  IF v_existing_lead_id IS NOT NULL THEN
    IF v_phone_normalized IS NOT NULL THEN
      UPDATE leads
      SET phone = v_phone_normalized,
          updated_at = NOW()
      WHERE id = v_existing_lead_id
        AND phone IS DISTINCT FROM v_phone_normalized;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'lead_id', v_existing_lead_id,
      'created', false,
      'lead_created', false,
      'funnel_applied', 'skipped_existing',
      'fallback_reason', NULL,
      'opportunity_id', NULL,
      'funnel_id', NULL,
      'stage_id', NULL,
      'is_over_plan', false,
      'source', 'whatsapp',
      'message', 'Lead já existe para este telefone'
    );
  END IF;

  SELECT pl.max_leads
  INTO v_max_leads
  FROM public.companies c
  LEFT JOIN public.plans pl ON pl.id = c.plan_id AND pl.is_active = true
  WHERE c.id = p_company_id;

  IF v_max_leads IS NOT NULL THEN
    SELECT COUNT(*) INTO v_current_leads
    FROM public.leads
    WHERE company_id = p_company_id
      AND deleted_at IS NULL;
    IF v_current_leads >= v_max_leads THEN
      v_is_over_plan := true;
    END IF;
  END IF;

  IF p_instance_id IS NOT NULL THEN
    SELECT wli.assigned_user_id,
           wli.lead_funnel_override_enabled,
           wli.default_funnel_id,
           wli.default_stage_id
    INTO v_assigned_user_id, v_flag, v_cfg_funnel, v_cfg_stage
    FROM whatsapp_life_instances wli
    WHERE wli.id = p_instance_id
      AND wli.company_id = p_company_id
      AND wli.deleted_at IS NULL
    FOR UPDATE;

    IF FOUND THEN
      IF v_assigned_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM company_users cu
        WHERE cu.user_id = v_assigned_user_id
          AND cu.company_id = p_company_id
          AND cu.is_active = true
      ) THEN
        v_assigned_user_id := NULL;
      END IF;

      IF v_flag AND v_cfg_funnel IS NOT NULL AND v_cfg_stage IS NOT NULL THEN
        SELECT true INTO v_funnel_active
        FROM sales_funnels f
        WHERE f.id = v_cfg_funnel
          AND f.company_id = p_company_id
          AND f.is_active = true
        FOR UPDATE;

        SELECT true INTO v_stage_belongs
        FROM funnel_stages s
        WHERE s.id = v_cfg_stage
          AND s.funnel_id = v_cfg_funnel
        FOR UPDATE;

        IF COALESCE(v_funnel_active, false) AND COALESCE(v_stage_belongs, false) THEN
          v_use_hint := true;
        ELSE
          v_fallback_reason := 'invalid_config';
        END IF;
      ELSIF v_flag THEN
        v_fallback_reason := 'invalid_config';
      END IF;
    END IF;
  END IF;

  v_lead_id := nextval('public.leads_id_seq');

  IF v_use_hint THEN
    INSERT INTO public.whatsapp_instance_lead_funnel_hints (
      lead_id, company_id, instance_id, funnel_id, stage_id
    ) VALUES (
      v_lead_id, p_company_id, p_instance_id, v_cfg_funnel, v_cfg_stage
    );
  END IF;

  INSERT INTO leads (
    id, company_id, phone, name, origin, status, record_type,
    is_over_plan, responsible_user_id, created_at, updated_at
  ) VALUES (
    v_lead_id,
    p_company_id,
    v_phone_normalized,
    COALESCE(p_name, 'Lead WhatsApp'),
    'whatsapp',
    'novo',
    'Lead',
    v_is_over_plan,
    v_assigned_user_id,
    NOW(),
    NOW()
  );

  SELECT ofp.opportunity_id, ofp.funnel_id, ofp.stage_id
  INTO v_opportunity_id, v_out_funnel, v_out_stage
  FROM opportunity_funnel_positions ofp
  WHERE ofp.lead_id = v_lead_id
  LIMIT 1;

  IF v_opportunity_id IS NULL THEN
    v_funnel_applied := 'none';
    v_fallback_reason := COALESCE(v_fallback_reason, 'no_default_funnel');
  ELSIF v_use_hint
        AND v_out_funnel IS NOT DISTINCT FROM v_cfg_funnel
        AND v_out_stage IS NOT DISTINCT FROM v_cfg_stage THEN
    v_funnel_applied := 'configured';
    v_fallback_reason := NULL;
  ELSE
    v_funnel_applied := 'default';
    IF v_use_hint THEN
      v_fallback_reason := COALESCE(v_fallback_reason, 'destination_gone');
    END IF;
  END IF;

  IF v_funnel_applied = 'none' THEN
    RAISE LOG 'create_lead_from_whatsapp_safe v9: lead % sem posição reason=%',
      v_lead_id, v_fallback_reason;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id,
    'created', true,
    'lead_created', true,
    'funnel_applied', v_funnel_applied,
    'fallback_reason', v_fallback_reason,
    'opportunity_id', v_opportunity_id,
    'funnel_id', v_out_funnel,
    'stage_id', v_out_stage,
    'is_over_plan', v_is_over_plan,
    'responsible_user_id', v_assigned_user_id,
    'source', 'whatsapp',
    'message', CASE
      WHEN v_funnel_applied = 'none' THEN
        'Lead criado; funil não aplicado'
      WHEN v_is_over_plan THEN
        'Lead criado via WhatsApp (empresa acima do limite do plano)'
      ELSE
        'Lead criado com sucesso via WhatsApp'
    END
  );

EXCEPTION
  WHEN deadlock_detected THEN
    RAISE LOG 'create_lead_from_whatsapp_safe v9: deadlock_detected 40P01';
    RETURN jsonb_build_object(
      'success', false,
      'error', 'deadlock_detected',
      'error_code', '40P01',
      'created', false,
      'lead_created', false
    );
  WHEN OTHERS THEN
    RAISE LOG 'create_lead_from_whatsapp_safe v9: ERRO - %', SQLERRM;
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

ALTER FUNCTION public.create_lead_from_whatsapp_safe_v9(uuid, text, text, uuid) OWNER TO postgres;

CREATE OR REPLACE FUNCTION public.create_or_link_instagram_lead(p_conversation_id uuid, p_name text, p_performed_by uuid, p_phone text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_ip_address text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conv                 public.instagram_conversations%ROWTYPE;
  v_responsible_user_id  UUID;
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
  v_metadata             JSONB;
BEGIN
  IF auth.role() IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'Esta funcao e exclusiva do backend (service_role)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_conv
  FROM public.instagram_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'conversation_not_found');
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'name e obrigatorio');
  END IF;

  IF (p_phone IS NULL OR trim(p_phone) = '')
     AND (p_email IS NULL OR trim(p_email) = '') THEN
    RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'phone ou email e obrigatorio');
  END IF;

  IF p_phone IS NOT NULL AND trim(p_phone) != '' THEN
    v_phone_norm := REGEXP_REPLACE(p_phone, '[^0-9]', '', 'g');
    IF LENGTH(v_phone_norm) < 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'telefone deve ter pelo menos 10 digitos');
    END IF;
  END IF;

  IF p_email IS NOT NULL AND trim(p_email) != '' THEN
    v_email_norm := lower(trim(p_email));
    IF v_email_norm !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'validation_error', 'detail', 'email com formato invalido');
    END IF;
  END IF;

  IF v_conv.lead_id IS NOT NULL THEN
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
        'conversation_id',      p_conversation_id,
        'lead_id',              v_conv.lead_id,
        'ig_participant_id',    v_conv.ig_participant_id,
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ig_lead:' || v_conv.company_id::TEXT || ':' || v_conv.ig_participant_id, 0)
  );

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

  IF v_existing_lead_id IS NULL AND v_email_norm IS NOT NULL THEN
    SELECT id INTO v_existing_lead_id
    FROM public.leads
    WHERE company_id         = v_conv.company_id
      AND deleted_at         IS NULL
      AND lower(trim(email)) = v_email_norm
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_existing_lead_id IS NOT NULL THEN
      v_matched_by := 'email';
    END IF;
  END IF;

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

  SELECT COALESCE(v_conv.assigned_to, s.default_assignee)
  INTO   v_responsible_user_id
  FROM   public.instagram_company_settings s
  WHERE  s.company_id = v_conv.company_id;

  IF NOT FOUND THEN
    v_responsible_user_id := v_conv.assigned_to;
  END IF;

  IF v_existing_lead_id IS NOT NULL THEN
    v_lead_id      := v_existing_lead_id;
    v_is_duplicate := true;
    v_action       := 'lead_linked';
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

    INSERT INTO public.leads (
      company_id, name, phone, email, origin, status,
      responsible_user_id, record_type, is_over_plan,
      created_at, updated_at
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

  INSERT INTO public.lead_social_profiles (
    lead_id, company_id, provider, provider_user_id,
    username, display_name, avatar_url,
    created_at, updated_at
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

  UPDATE public.instagram_conversations
  SET    lead_id    = v_lead_id,
         updated_at = NOW()
  WHERE  id = p_conversation_id;

  v_metadata := jsonb_build_object(
    'conversation_id',      p_conversation_id,
    'lead_id',              v_lead_id,
    'matched_by',           v_matched_by,
    'is_duplicate',         v_is_duplicate,
    'ig_participant_id',    v_conv.ig_participant_id,
    'participant_username',  v_conv.participant_username,
    'action',               v_action
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
$function$;

ALTER FUNCTION public.create_or_link_instagram_lead(uuid, text, uuid, text, text, text, text) OWNER TO postgres;

DROP FUNCTION public.public_create_tracking_lead(text, text, text, text, text, text, text, text, text, text, text, text, text, text);

CREATE FUNCTION public.public_create_tracking_lead(p_tracking_code text, p_persistent_visitor_id text, p_session_id text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_interest text DEFAULT NULL::text, p_company_name text DEFAULT NULL::text, p_company_cnpj text DEFAULT NULL::text, p_company_email text DEFAULT NULL::text, p_campanha text DEFAULT NULL::text, p_conjunto_anuncio text DEFAULT NULL::text, p_anuncio text DEFAULT NULL::text, p_utm_medium text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, error_code text, lead_id integer, visit_id uuid, persistent_visitor_id uuid, session_id uuid, landing_page_id uuid, company_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tracking_code uuid;
  v_persistent_visitor_id uuid;
  v_session_id uuid;
  v_name text;
  v_email text;
  v_resolve record;
  v_lead_id integer;
BEGIN
  IF p_tracking_code IS NULL OR btrim(p_tracking_code) = '' THEN
    success := false;
    error_code := 'INVALID_TRACKING_CODE';
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_tracking_code := btrim(p_tracking_code)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      success := false;
      error_code := 'INVALID_TRACKING_CODE';
      lead_id := NULL;
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      company_id := NULL;
      RETURN NEXT;
      RETURN;
  END;

  IF p_persistent_visitor_id IS NULL OR btrim(p_persistent_visitor_id) = '' THEN
    success := false;
    error_code := 'INVALID_PERSISTENT_VISITOR_ID';
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  BEGIN
    v_persistent_visitor_id := btrim(p_persistent_visitor_id)::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      success := false;
      error_code := 'INVALID_PERSISTENT_VISITOR_ID';
      lead_id := NULL;
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      company_id := NULL;
      RETURN NEXT;
      RETURN;
  END;

  IF p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    v_session_id := NULL;
  ELSE
    BEGIN
      v_session_id := btrim(p_session_id)::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        success := false;
        error_code := 'INVALID_SESSION_ID';
        lead_id := NULL;
        visit_id := NULL;
        persistent_visitor_id := NULL;
        session_id := NULL;
        landing_page_id := NULL;
        company_id := NULL;
        RETURN NEXT;
        RETURN;
    END;
  END IF;

  v_name := btrim(p_name);
  IF v_name IS NULL OR v_name = '' THEN
    success := false;
    error_code := 'INVALID_LEAD_NAME';
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_email IS NULL OR btrim(p_email) = '' THEN
    v_email := NULL;
  ELSE
    v_email := btrim(p_email);
    IF NOT (v_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$') THEN
      success := false;
      error_code := 'INVALID_LEAD_EMAIL';
      lead_id := NULL;
      visit_id := NULL;
      persistent_visitor_id := NULL;
      session_id := NULL;
      landing_page_id := NULL;
      company_id := NULL;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT r.*
    INTO v_resolve
  FROM public.resolve_tracking_visit(
    v_tracking_code,
    v_persistent_visitor_id,
    v_session_id
  ) r
  LIMIT 1;

  IF v_resolve.success IS NOT TRUE THEN
    success := false;
    error_code := COALESCE(v_resolve.error_code, 'VISIT_NOT_FOUND');
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.leads (
    company_id,
    name,
    visitor_id,
    email,
    phone,
    interest,
    company_name,
    company_cnpj,
    company_email,
    campanha,
    conjunto_anuncio,
    anuncio,
    utm_medium
  ) VALUES (
    v_resolve.company_id,
    v_name,
    v_persistent_visitor_id::text,
    v_email,
    p_phone,
    p_interest,
    p_company_name,
    p_company_cnpj,
    p_company_email,
    p_campanha,
    p_conjunto_anuncio,
    p_anuncio,
    p_utm_medium
  )
  RETURNING id INTO v_lead_id;

  IF v_lead_id IS NULL THEN
    success := false;
    error_code := 'INTERNAL_ERROR';
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  success := true;
  error_code := NULL;
  lead_id := v_lead_id;
  visit_id := v_resolve.visit_id;
  persistent_visitor_id := v_resolve.persistent_visitor_id;
  session_id := v_resolve.session_id;
  landing_page_id := v_resolve.landing_page_id;
  company_id := v_resolve.company_id;
  RETURN NEXT;
  RETURN;

EXCEPTION
  WHEN OTHERS THEN
    success := false;
    error_code := 'INTERNAL_ERROR';
    lead_id := NULL;
    visit_id := NULL;
    persistent_visitor_id := NULL;
    session_id := NULL;
    landing_page_id := NULL;
    company_id := NULL;
    RETURN NEXT;
    RETURN;
END;
$function$;

ALTER FUNCTION public.public_create_tracking_lead(text, text, text, text, text, text, text, text, text, text, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.public_create_tracking_lead(text, text, text, text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_create_tracking_lead(text, text, text, text, text, text, text, text, text, text, text, text, text, text) TO anon, authenticated, service_role;

DROP FUNCTION public.get_leads_for_notifications(integer[], uuid);

CREATE FUNCTION public.get_leads_for_notifications(p_lead_ids integer[], p_company_id uuid)
 RETURNS TABLE(id integer, name text, email text, phone text, responsible_user_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT l.id, l.name, l.email, l.phone, l.responsible_user_id
  FROM leads l
  WHERE l.id = ANY(p_lead_ids)
    AND l.company_id = p_company_id
    AND l.deleted_at IS NULL
    AND (l.duplicate_status IS NULL OR l.duplicate_status != 'merged');
END;
$function$;

ALTER FUNCTION public.get_leads_for_notifications(integer[], uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_leads_for_notifications(integer[], uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leads_for_notifications(integer[], uuid) TO anon, authenticated, service_role;

DROP FUNCTION public.get_pending_duplicate_notifications(uuid);

CREATE FUNCTION public.get_pending_duplicate_notifications(p_company_id uuid)
 RETURNS TABLE(notification_id integer, lead_id integer, lead_name text, lead_email text, lead_phone text, duplicate_of_lead_id integer, duplicate_name text, duplicate_email text, duplicate_phone text, reason text, created_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        dn.id,
        l1.id,
        l1.name,
        l1.email,
        l1.phone,
        l2.id,
        l2.name,
        l2.email,
        l2.phone,
        dn.reason,
        dn.created_at
    FROM duplicate_notifications dn
    JOIN leads l1 ON l1.id = dn.lead_id
    JOIN leads l2 ON l2.id = dn.duplicate_of_lead_id
    WHERE dn.company_id = p_company_id
      AND dn.status = 'pending'
      AND l1.deleted_at IS NULL
      AND l2.deleted_at IS NULL
    ORDER BY dn.created_at DESC;
END;
$function$;

ALTER FUNCTION public.get_pending_duplicate_notifications(uuid) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.get_pending_duplicate_notifications(uuid) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_pending_duplicate_notifications(uuid) TO anon, authenticated, service_role;

CREATE VIEW public.chat_conversations_with_leads AS
 SELECT cc.id,
    cc.company_id,
    COALESCE(cc.instance_id, cc.last_instance_id) AS instance_id,
    cc.contact_phone,
    COALESCE(NULLIF(l.name, ''::text), NULLIF(ctc.name::text, ''::text), cc.contact_name::text) AS contact_name,
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
     LEFT JOIN leads l ON l.phone_normalized = cc.contact_phone::text AND l.company_id = cc.company_id AND l.deleted_at IS NULL
     LEFT JOIN chat_contacts ctc ON ctc.company_id = cc.company_id AND ctc.phone_number::text = cc.contact_phone::text;

ALTER VIEW public.chat_conversations_with_leads OWNER TO postgres;
GRANT ALL ON TABLE public.chat_conversations_with_leads TO anon, authenticated, postgres, service_role;

DO $restore_policies$
DECLARE
  r record;
  v_cmd text;
  v_sql text;
BEGIN
  FOR r IN
    SELECT *
    FROM policy_snapshot
    ORDER BY relname, polname
  LOOP
    v_cmd := CASE r.cmd
      WHEN 'r' THEN 'SELECT'
      WHEN 'a' THEN 'INSERT'
      WHEN 'w' THEN 'UPDATE'
      WHEN 'd' THEN 'DELETE'
      WHEN '*' THEN 'ALL'
      ELSE NULL
    END;

    IF v_cmd IS NULL THEN
      RAISE EXCEPTION 'comando de policy desconhecido em %.%', r.relname, r.polname;
    END IF;

    v_sql := format(
      'CREATE POLICY %I ON public.%I AS %s FOR %s TO %s',
      r.polname,
      r.relname,
      CASE WHEN r.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
      v_cmd,
      r.roles
    );

    IF r.using_expr IS NOT NULL THEN
      v_sql := v_sql || ' USING (' || r.using_expr || ')';
    END IF;

    IF r.check_expr IS NOT NULL THEN
      v_sql := v_sql || ' WITH CHECK (' || r.check_expr || ')';
    END IF;

    EXECUTE v_sql;
  END LOOP;
END
$restore_policies$;

DO $check$
DECLARE
  v_snap_n bigint;
  v_snap_min integer;
  v_snap_max integer;
  v_snap_sum bigint;
  v_n bigint;
  v_min integer;
  v_max integer;
  v_sum bigint;
  v_seq_last bigint;
  v_seq_called boolean;
  v_snap_last bigint;
  v_snap_called boolean;
  v_snap_inc bigint;
  v_snap_cycle boolean;
  v_type text;
  v_max_value bigint;
  v_cycle boolean;
  v_inc bigint;
  v_default text;
  v_snap_default text;
  v_fk_count integer;
  v_index_count integer;
  v_owner name;
  v_view_type text;
BEGIN
  SELECT n, min_id, max_id, sum_id
    INTO v_snap_n, v_snap_min, v_snap_max, v_snap_sum
  FROM lead_id_snapshot;

  SELECT count(*)::bigint, min(id), max(id), coalesce(sum(id)::bigint, 0)
    INTO v_n, v_min, v_max, v_sum
  FROM public.leads;

  IF v_n IS DISTINCT FROM v_snap_n
     OR v_min IS DISTINCT FROM v_snap_min
     OR v_max IS DISTINCT FROM v_snap_max
     OR v_sum IS DISTINCT FROM v_snap_sum THEN
    RAISE EXCEPTION 'ids de leads mudaram durante a migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND format_type(a.atttypid, a.atttypmod) = 'smallint'
      AND (
        (c.relname = 'leads' AND a.attname IN ('id', 'duplicate_of_lead_id'))
        OR (c.relname = 'duplicate_notifications' AND a.attname IN ('lead_id', 'duplicate_of_lead_id'))
        OR (c.relname = 'lead_media_unified' AND a.attname = 'lead_id')
        OR (c.relname = 'lead_merge_history' AND a.attname IN ('source_lead_id', 'target_lead_id'))
        OR (c.relname = 'whatsapp_instance_lead_funnel_hints' AND a.attname = 'lead_id')
        OR (c.relname = 'chat_conversations_with_leads' AND a.attname = 'lead_id')
      )
  ) THEN
    RAISE EXCEPTION 'ainda existe coluna smallint de id de lead';
  END IF;

  SELECT column_default INTO v_snap_default FROM id_default_snapshot;

  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO v_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'leads'
    AND a.attname = 'id';

  IF v_default IS DISTINCT FROM v_snap_default THEN
    RAISE EXCEPTION 'default de leads.id mudou: %', v_default;
  END IF;

  IF pg_get_serial_sequence('public.leads', 'id') IS DISTINCT FROM 'public.leads_id_seq' THEN
    RAISE EXCEPTION 'leads.id nao esta mais ligado a leads_id_seq';
  END IF;

  SELECT last_value, is_called, increment_by, cycle
    INTO v_snap_last, v_snap_called, v_snap_inc, v_snap_cycle
  FROM seq_snapshot;

  SELECT last_value, is_called
    INTO v_seq_last, v_seq_called
  FROM public.leads_id_seq;

  SELECT data_type, max_value, cycle, increment_by
    INTO v_type, v_max_value, v_cycle, v_inc
  FROM pg_sequences
  WHERE schemaname = 'public'
    AND sequencename = 'leads_id_seq';

  IF v_seq_last IS DISTINCT FROM v_snap_last
     OR v_seq_called IS DISTINCT FROM v_snap_called
     OR v_inc IS DISTINCT FROM v_snap_inc
     OR v_cycle IS DISTINCT FROM v_snap_cycle THEN
    RAISE EXCEPTION 'estado da sequence divergiu do snapshot last=% called=%', v_seq_last, v_seq_called;
  END IF;

  IF v_type IS DISTINCT FROM 'integer'
     OR v_max_value IS DISTINCT FROM 2147483647
     OR v_cycle IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'sequence nao ficou integer sem ciclo: type=% max=% cycle=%', v_type, v_max_value, v_cycle;
  END IF;

  SELECT count(*) INTO v_fk_count
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public'
    AND c.contype = 'f'
    AND c.convalidated
    AND NOT c.condeferrable
    AND NOT c.condeferred
    AND c.conname IN (
      'automation_executions_lead_id_fkey',
      'chat_conversations_lead_id_fkey',
      'duplicate_notifications_duplicate_of_lead_id_fkey',
      'duplicate_notifications_lead_id_fkey',
      'instagram_comments_lead_id_fkey',
      'instagram_conversations_lead_id_fkey',
      'internal_notes_lead_id_fkey',
      'lead_activities_lead_id_fkey',
      'lead_custom_values_lead_id_fkey',
      'lead_entries_lead_id_fkey',
      'lead_import_events_lead_id_fkey',
      'lead_media_unified_lead_id_fkey',
      'lead_social_profiles_lead_id_fkey',
      'lead_stage_history_lead_id_fkey',
      'lead_tag_assignments_lead_id_fkey',
      'opportunities_lead_id_fkey',
      'lead_funnel_positions_lead_id_fkey',
      'system_notifications_lead_id_fkey',
      'webhook_api_logs_lead_id_fkey',
      'webhook_trigger_logs_lead_id_fkey'
    );

  IF v_fk_count IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'FKs validadas encontradas: %', v_fk_count;
  END IF;

  SELECT count(*) INTO v_index_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_index i ON i.indexrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'leads_pkey',
      'whatsapp_instance_lead_funnel_hints_pkey',
      'idx_lead_media_company_lead',
      'idx_lead_merge_history_source',
      'idx_lead_merge_history_target'
    )
    AND i.indisvalid
    AND i.indisready;

  IF v_index_count IS DISTINCT FROM 5 THEN
    RAISE EXCEPTION 'indices validos encontrados: %', v_index_count;
  END IF;

  SELECT r.rolname, c.reloptions IS NULL
    INTO v_owner, v_cycle
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_roles r ON r.oid = c.relowner
  WHERE n.nspname = 'public'
    AND c.relname = 'chat_conversations_with_leads'
    AND c.relkind = 'v';

  IF v_owner IS DISTINCT FROM 'postgres' OR v_cycle IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'view com owner % ou reloptions inesperado', v_owner;
  END IF;

  SELECT format_type(a.atttypid, a.atttypmod)
    INTO v_view_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'chat_conversations_with_leads'
    AND a.attname = 'lead_id';

  IF v_view_type IS DISTINCT FROM 'integer' THEN
    RAISE EXCEPTION 'view.lead_id ficou %', v_view_type;
  END IF;

  IF NOT (
       has_table_privilege('anon', 'public.chat_conversations_with_leads', 'SELECT')
       AND has_table_privilege('anon', 'public.chat_conversations_with_leads', 'INSERT')
       AND has_table_privilege('anon', 'public.chat_conversations_with_leads', 'UPDATE')
       AND has_table_privilege('anon', 'public.chat_conversations_with_leads', 'DELETE')
       AND has_table_privilege('authenticated', 'public.chat_conversations_with_leads', 'SELECT')
       AND has_table_privilege('authenticated', 'public.chat_conversations_with_leads', 'INSERT')
       AND has_table_privilege('authenticated', 'public.chat_conversations_with_leads', 'UPDATE')
       AND has_table_privilege('authenticated', 'public.chat_conversations_with_leads', 'DELETE')
       AND has_table_privilege('service_role', 'public.chat_conversations_with_leads', 'SELECT')
       AND has_table_privilege('service_role', 'public.chat_conversations_with_leads', 'INSERT')
       AND has_table_privilege('service_role', 'public.chat_conversations_with_leads', 'UPDATE')
       AND has_table_privilege('service_role', 'public.chat_conversations_with_leads', 'DELETE')
     ) THEN
    RAISE EXCEPTION 'grants da view nao foram restaurados';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'detect_lead_duplicates',
        'take_whatsapp_instance_lead_funnel_hint',
        'check_lead_duplicates_trigger',
        'process_retroactive_duplicates',
        'get_leads_for_notifications',
        'get_pending_duplicate_notifications',
        'create_lead_from_whatsapp_safe_v9',
        'create_or_link_instagram_lead',
        'public_create_tracking_lead'
      ])
      AND (
        pg_get_function_identity_arguments(p.oid) ILIKE '%smallint%'
        OR pg_get_function_result(p.oid) ILIKE '%smallint%'
        OR p.prosrc ILIKE '%smallint%'
      )
  ) THEN
    RAISE EXCEPTION 'smallint permanece em caminho de id de lead';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'create_lead_from_whatsapp_safe'
      AND pg_get_function_identity_arguments(p.oid) = 'p_company_id uuid, p_phone text, p_name text, p_instance_id uuid'
      AND p.prosrc ILIKE '%bigint%'
      AND p.prosrc NOT ILIKE '%smallint%'
  ) THEN
    RAISE EXCEPTION 'create_lead_from_whatsapp_safe v8 nao permaneceu compativel';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'detect_lead_duplicates'
      AND pg_get_function_identity_arguments(p.oid) = 'new_lead_id integer'
      AND pg_get_function_result(p.oid) = 'TABLE(duplicate_id integer, reason text)'
  ) THEN
    RAISE EXCEPTION 'assinatura de detect_lead_duplicates incorreta';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'take_whatsapp_instance_lead_funnel_hint'
      AND pg_get_function_identity_arguments(p.oid) = 'p_lead_id integer, p_company_id uuid'
  ) THEN
    RAISE EXCEPTION 'assinatura do hint de funil incorreta';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'public_create_tracking_lead'
      AND pg_get_function_result(p.oid) ILIKE '%lead_id integer%'
  ) THEN
    RAISE EXCEPTION 'retorno de public_create_tracking_lead incorreto';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM policy_snapshot s
    JOIN pg_class c ON c.relname = s.relname
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = s.polname
    WHERE p.polcmd::text IS DISTINCT FROM s.cmd
       OR p.polpermissive IS DISTINCT FROM s.polpermissive
       OR c.relrowsecurity IS DISTINCT FROM s.relrowsecurity
       OR c.relforcerowsecurity IS DISTINCT FROM s.relforcerowsecurity
       OR coalesce(pg_get_expr(p.polqual, p.polrelid), '')
            IS DISTINCT FROM coalesce(s.using_expr, '')
       OR coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
            IS DISTINCT FROM coalesce(s.check_expr, '')
       OR coalesce((
            SELECT string_agg(
              CASE WHEN role_id = 0 THEN 'public' ELSE pg_get_userbyid(role_id) END,
              ',' ORDER BY role_id
            )
            FROM unnest(p.polroles) AS role_id
          ), '') IS DISTINCT FROM s.roles
  ) OR (
    SELECT count(*)
    FROM policy_snapshot s
    JOIN pg_class c ON c.relname = s.relname
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = s.polname
  ) IS DISTINCT FROM (SELECT count(*) FROM policy_snapshot) THEN
    RAISE EXCEPTION 'policies ou RLS nao foram restaurados como no snapshot';
  END IF;
END
$check$;

NOTIFY pgrst, 'reload schema';

COMMIT;
