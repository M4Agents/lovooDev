-- =====================================================
-- MIGRATION: Funções de backfill/merge por telefone canônico
-- Data: 2026-07-25
-- Depende de: 20260725120000_canonicalize_br_mobile_phone.sql
--
-- IMPORTANTE:
--   Esta migration NÃO executa backfill nem merge automaticamente.
--   DEV e produção compartilham o mesmo banco — apply só cria funções.
--
-- Sequência segura (manual):
--   1) SELECT public.preview_br_canonical_phone_duplicates(NULL);
--   2) SELECT public.backfill_br_canonical_phones('<company_id>');  -- ou NULL
--   3) SELECT public.merge_br_canonical_phone_duplicates('<company_id>');
--   4) Após validar (ex: Valleron), repetir com NULL para global
-- =====================================================

-- ── 1. Preview (dry-run) de pares canônicos ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.preview_br_canonical_phone_duplicates(
  p_company_id uuid DEFAULT NULL
)
RETURNS TABLE (
  company_id uuid,
  canon text,
  lead_count bigint,
  keep_id integer,
  discard_ids integer[],
  lead_ids integer[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH groups AS (
    SELECT
      l.company_id,
      public.canonicalize_br_mobile_phone(l.phone) AS canon,
      array_agg(l.id ORDER BY l.created_at ASC, l.id ASC) AS ids
    FROM public.leads l
    WHERE l.deleted_at IS NULL
      AND l.phone IS NOT NULL
      AND BTRIM(l.phone) <> ''
      AND (p_company_id IS NULL OR l.company_id = p_company_id)
      AND LENGTH(public.canonicalize_br_mobile_phone(l.phone)) >= 12
    GROUP BY l.company_id, public.canonicalize_br_mobile_phone(l.phone)
    HAVING COUNT(*) > 1
  )
  SELECT
    g.company_id,
    g.canon,
    cardinality(g.ids)::bigint AS lead_count,
    g.ids[1] AS keep_id,
    g.ids[2:cardinality(g.ids)] AS discard_ids,
    g.ids AS lead_ids
  FROM groups g
  ORDER BY g.company_id, g.canon;
$$;

COMMENT ON FUNCTION public.preview_br_canonical_phone_duplicates(uuid) IS
  'Dry-run: lista pares/grupos de leads com o mesmo telefone canônico BR.';

REVOKE ALL ON FUNCTION public.preview_br_canonical_phone_duplicates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_br_canonical_phone_duplicates(uuid) TO service_role;

-- ── 2. Backfill opt-in (por empresa ou global) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.backfill_br_canonical_phones(
  p_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_updated integer := 0;
BEGIN
  UPDATE public.leads
  SET phone = public.canonicalize_br_mobile_phone(phone),
      updated_at = NOW()
  WHERE deleted_at IS NULL
    AND phone IS NOT NULL
    AND BTRIM(phone) <> ''
    AND (p_company_id IS NULL OR company_id = p_company_id)
    AND public.canonicalize_br_mobile_phone(phone) IS DISTINCT FROM phone;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'updated_leads', v_updated,
    'company_id', p_company_id
  );
END;
$$;

COMMENT ON FUNCTION public.backfill_br_canonical_phones(uuid) IS
  'Atualiza leads.phone para o formato canônico BR. Escopo: company_id ou NULL=global.';

REVOKE ALL ON FUNCTION public.backfill_br_canonical_phones(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_br_canonical_phones(uuid) TO service_role;

-- ── 3. Merge opt-in (por empresa ou global) ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.merge_br_canonical_phone_duplicates(
  p_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
  v_keep_id INTEGER;
  v_discard_id INTEGER;
  v_user_id UUID;
  v_company_id UUID;
  v_merged_count INTEGER := 0;
  v_failed_count INTEGER := 0;
  v_errors jsonb := '[]'::jsonb;
  v_source leads%ROWTYPE;
  v_target leads%ROWTYPE;
BEGIN
  FOR r IN
    WITH groups AS (
      SELECT
        l.company_id,
        public.canonicalize_br_mobile_phone(l.phone) AS canon,
        array_agg(l.id ORDER BY l.created_at ASC, l.id ASC) AS ids
      FROM public.leads l
      WHERE l.deleted_at IS NULL
        AND l.phone IS NOT NULL
        AND BTRIM(l.phone) <> ''
        AND (p_company_id IS NULL OR l.company_id = p_company_id)
        AND LENGTH(public.canonicalize_br_mobile_phone(l.phone)) >= 12
      GROUP BY l.company_id, public.canonicalize_br_mobile_phone(l.phone)
      HAVING COUNT(*) > 1
    )
    SELECT company_id, canon, ids
    FROM groups
    ORDER BY company_id, canon
  LOOP
    v_keep_id := r.ids[1];
    v_company_id := r.company_id;

    SELECT cu.user_id
      INTO v_user_id
    FROM public.company_users cu
    WHERE cu.company_id = r.company_id
      AND cu.is_active = true
    ORDER BY
      CASE lower(COALESCE(cu.role, ''))
        WHEN 'super_admin' THEN 0
        WHEN 'system_admin' THEN 1
        WHEN 'admin' THEN 2
        ELSE 3
      END,
      cu.created_at ASC NULLS LAST
    LIMIT 1;

    FOR i IN 2..array_length(r.ids, 1) LOOP
      v_discard_id := r.ids[i];

      BEGIN
        SELECT * INTO v_source FROM public.leads WHERE id = v_discard_id AND deleted_at IS NULL;
        IF NOT FOUND THEN
          CONTINUE;
        END IF;

        SELECT * INTO v_target FROM public.leads WHERE id = v_keep_id AND deleted_at IS NULL;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Lead destino % não encontrado', v_keep_id;
        END IF;

        IF v_source.company_id IS DISTINCT FROM v_target.company_id THEN
          RAISE EXCEPTION 'Leads de empresas diferentes';
        END IF;

        -- merge_fields: mantém o mais antigo (keep), mescla campos e soft-delete o mais novo
        UPDATE public.leads SET
          name = CASE
            WHEN LENGTH(COALESCE(v_source.name, '')) > LENGTH(COALESCE(v_target.name, ''))
            THEN v_source.name ELSE v_target.name END,
          email         = COALESCE(v_source.email, v_target.email),
          phone         = r.canon,
          interest      = COALESCE(v_source.interest, v_target.interest),
          company_name  = COALESCE(v_source.company_name, v_target.company_name),
          company_cnpj  = COALESCE(v_source.company_cnpj, v_target.company_cnpj),
          company_email = COALESCE(v_source.company_email, v_target.company_email),
          visitor_id    = COALESCE(v_target.visitor_id, v_source.visitor_id),
          updated_at    = NOW()
        WHERE id = v_keep_id;

        UPDATE public.leads
        SET deleted_at = NOW(),
            duplicate_status = 'merged',
            updated_at = NOW()
        WHERE id = v_discard_id;

        UPDATE public.opportunities
          SET lead_id = v_keep_id, updated_at = NOW()
        WHERE lead_id = v_discard_id AND company_id = v_company_id;

        UPDATE public.opportunity_funnel_positions
          SET lead_id = v_keep_id
        WHERE lead_id = v_discard_id;

        BEGIN
          UPDATE public.lead_entries
            SET lead_id = v_keep_id
          WHERE lead_id = v_discard_id AND company_id = v_company_id;
        EXCEPTION WHEN undefined_table THEN
          NULL;
        END;

        UPDATE public.chat_conversations
          SET lead_id = v_keep_id
        WHERE lead_id = v_discard_id AND company_id = v_company_id;

        BEGIN
          INSERT INTO public.lead_merge_history (
            source_lead_id, target_lead_id, merged_by_user_id, merge_strategy, created_at
          ) VALUES (
            v_discard_id, v_keep_id, v_user_id, 'merge_fields', NOW()
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;

        v_merged_count := v_merged_count + 1;
      EXCEPTION WHEN OTHERS THEN
        v_failed_count := v_failed_count + 1;
        v_errors := v_errors || jsonb_build_object(
          'keep_id', v_keep_id,
          'discard_id', v_discard_id,
          'error', SQLERRM
        );
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'merged_pairs', v_merged_count,
    'failed_pairs', v_failed_count,
    'company_id', p_company_id,
    'errors', v_errors
  );
END;
$$;

COMMENT ON FUNCTION public.merge_br_canonical_phone_duplicates(uuid) IS
  'Mescla leads duplicados pelo telefone canônico BR (mantém o mais antigo). Escopo opt-in.';

REVOKE ALL ON FUNCTION public.merge_br_canonical_phone_duplicates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_br_canonical_phone_duplicates(uuid) TO service_role;
