-- =====================================================
-- MIGRATION: add_owner_filter_to_funnel_rpcs
-- Data: 25/06/2026
-- Objetivo: Adicionar parâmetro p_owner_user_id às RPCs
--           get_stage_positions_paged e get_funnel_stage_counts
--           para suportar filtro por responsável da oportunidade
--           no painel de filtros do funil de vendas.
--
-- Campo filtrado: opportunities.owner_user_id
--
-- Estratégia: DROP + CREATE
--   Cada RPC muda de assinatura (13 → 14 e 9 → 10 parâmetros).
--   O DROP remove apenas a assinatura canônica atual. Os overloads
--   legados (8, 10 params para positions; 5, 7 params para counts)
--   permanecem inalterados.
--
-- Parâmetro novo (em ambas):
--   p_owner_user_id UUID DEFAULT NULL
--     NULL   → sem filtro (comportamento atual preservado)
--     UUID   → filtra oportunidades onde o.owner_user_id = p_owner_user_id
--
-- Segurança:
--   A restrição auth_user_restricted_to_own_leads() é preservada
--   integralmente. O novo filtro é adicionado como cláusula AND
--   complementar — nunca substitui a restrição existente.
--
--   Comportamento para seller restrito que filtra por outro usuário:
--     AND (NOT v_restricted OR l.responsible_user_id = auth.uid())
--     AND (p_owner_user_id IS NULL OR o.owner_user_id = p_owner_user_id)
--   → Ambas as condições aplicadas via AND → resultado = 0 oportunidades
--     para o seller. Nenhuma exposição de dados ocorre.
--
-- Multi-tenant:
--   AND o.company_id = p_company_id permanece inalterado.
--
-- Compatibilidade retroativa:
--   DEFAULT NULL garante que chamadas sem p_owner_user_id continuem
--   funcionando exatamente como antes.
--
-- Overloads legados NÃO alterados:
--   get_stage_positions_paged (8 params)  — inalterado
--   get_stage_positions_paged (10 params) — inalterado
--   get_funnel_stage_counts   (5 params)  — inalterado
--   get_funnel_stage_counts   (7 params)  — inalterado
-- =====================================================

-- ══════════════════════════════════════════════════════════════════════════
-- 1. get_stage_positions_paged (13 → 14 parâmetros)
-- ══════════════════════════════════════════════════════════════════════════

-- ── DROP da assinatura canônica atual (13 params) ────────────────────────
DROP FUNCTION IF EXISTS get_stage_positions_paged(
  UUID,         -- p_funnel_id
  UUID,         -- p_stage_id
  UUID,         -- p_company_id
  TEXT,         -- p_search
  TEXT,         -- p_origin
  INT,          -- p_period_days
  INT,          -- p_limit
  INT,          -- p_offset
  UUID[],       -- p_tag_ids
  TEXT,         -- p_tag_mode
  TIMESTAMPTZ,  -- p_start_date
  TIMESTAMPTZ,  -- p_end_date
  TEXT          -- p_sort_by
);

-- ── CREATE com 14 parâmetros ──────────────────────────────────────────────
-- Corpo preservado integralmente da migration 20260625143000.
-- Única alteração: novo parâmetro p_owner_user_id + cláusula AND no WHERE.
CREATE OR REPLACE FUNCTION get_stage_positions_paged(
  p_funnel_id      UUID,
  p_stage_id       UUID,
  p_company_id     UUID,
  p_search         TEXT        DEFAULT NULL,
  p_origin         TEXT        DEFAULT NULL,
  p_period_days    INT         DEFAULT NULL,
  p_limit          INT         DEFAULT 20,
  p_offset         INT         DEFAULT 0,
  p_tag_ids        UUID[]      DEFAULT NULL,
  p_tag_mode       TEXT        DEFAULT 'or',
  p_start_date     TIMESTAMPTZ DEFAULT NULL,
  p_end_date       TIMESTAMPTZ DEFAULT NULL,
  p_sort_by        TEXT        DEFAULT NULL,
  p_owner_user_id  UUID        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  -- ── Guard: acesso ao funil ────────────────────────────────
  IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

  -- ── Validação p_tag_mode ──────────────────────────────────
  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  -- ── Sanitização p_sort_by: valor inválido → NULL ─────────
  -- NULL é passado integralmente (p_sort_by IS NULL → comportamento padrão).
  -- Valores não reconhecidos são silenciados → NULL → comportamento padrão.
  IF p_sort_by IS NOT NULL AND p_sort_by NOT IN ('entered_stage_at', 'entered_funnel_at', 'lead_created_at', 'last_interaction_at') THEN
    p_sort_by := NULL;
  END IF;

  -- ── Restrição por responsável ─────────────────────────────
  v_restricted := auth_user_restricted_to_own_leads(p_company_id);

  SELECT COALESCE(
    jsonb_agg(
      row_data
      ORDER BY
        -- Ordenação dinâmica quando p_sort_by está definido.
        -- Quando NULL, todos os valores do CASE são NULL e o sort
        -- cai nos critérios seguintes (comportamento padrão preservado).
        CASE
          WHEN p_sort_by = 'entered_stage_at'    THEN (row_data->>'entered_stage_at')::timestamptz
          WHEN p_sort_by = 'entered_funnel_at'   THEN (row_data->'opportunity'->>'created_at')::timestamptz
          WHEN p_sort_by = 'lead_created_at'     THEN (row_data->'opportunity'->'lead'->>'created_at')::timestamptz
          WHEN p_sort_by = 'last_interaction_at' THEN (row_data->'opportunity'->'lead'->>'last_contact_at')::timestamptz
          ELSE NULL
        END DESC NULLS LAST,
        -- Fallback exato ao comportamento original
        (row_data->>'position_in_stage')::int        ASC,
        (row_data->>'entered_stage_at')::timestamptz DESC NULLS LAST,
        (row_data->>'id')::text                      ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id',                ofp.id,
      'opportunity_id',    ofp.opportunity_id,
      'lead_id',           ofp.lead_id,
      'funnel_id',         ofp.funnel_id,
      'stage_id',          ofp.stage_id,
      'position_in_stage', ofp.position_in_stage,
      'entered_stage_at',  ofp.entered_stage_at,
      'updated_at',        ofp.updated_at,
      'opportunity', jsonb_build_object(
        'id',                  o.id,
        'lead_id',             o.lead_id,
        'company_id',          o.company_id,
        'title',               o.title,
        'description',         o.description,
        'value',               o.value,
        'currency',            o.currency,
        'status',              o.status,
        'probability',         o.probability,
        'expected_close_date', o.expected_close_date,
        'actual_close_date',   o.actual_close_date,
        'source',              o.source,
        'owner_user_id',       o.owner_user_id,
        'created_at',          o.created_at,
        'updated_at',          o.updated_at,
        'closed_at',           o.closed_at,
        'lead', jsonb_build_object(
          'id',                  l.id,
          'name',                l.name,
          'email',               l.email,
          'phone',               l.phone,
          'company_name',        l.company_name,
          'created_at',          l.created_at,
          'origin',              l.origin,
          'status',              l.status,
          'record_type',         l.record_type,
          'last_contact_at',     l.last_contact_at,
          'profile_picture_url', cc.profile_picture_url,
          'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb),
          'tags', COALESCE(
            (SELECT jsonb_agg(lt2.name ORDER BY lt2.name)
             FROM   lead_tag_assignments lta2
             JOIN   lead_tags lt2 ON lt2.id = lta2.tag_id
             WHERE  lta2.lead_id   = l.id
               AND  lt2.is_active  = true),
            '[]'::jsonb
          )
        )
      )
    ) AS row_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities  o  ON o.id  = ofp.opportunity_id
    JOIN  leads          l  ON l.id  = o.lead_id
    LEFT JOIN chat_contacts cc ON
      l.phone_normalized = cc.phone_number
      AND l.company_id   = cc.company_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
      FROM   chat_conversations cv
      WHERE  cv.contact_phone = l.phone_normalized
        AND  cv.company_id    = l.company_id
      ORDER  BY cv.last_message_at DESC NULLS LAST
      LIMIT  1
    ) conv ON true
    WHERE ofp.funnel_id  = p_funnel_id
      AND ofp.stage_id   = p_stage_id
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      -- Restrição por responsável: seller restrito vê apenas seus leads.
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (
        p_search IS NULL
        OR l.name         ILIKE '%' || p_search || '%'
        OR l.phone        ILIKE '%' || p_search || '%'
        OR l.email        ILIKE '%' || p_search || '%'
        OR l.company_name ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (
        CASE
          WHEN p_start_date IS NOT NULL THEN o.created_at >= p_start_date
          WHEN p_period_days IS NOT NULL THEN o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL
          ELSE TRUE
        END
      )
      AND (p_end_date IS NULL OR o.created_at <= p_end_date)
      AND (
        p_tag_ids IS NULL
        OR cardinality(p_tag_ids) = 0
        OR (
          p_tag_mode = 'or'
          AND EXISTS (
            SELECT 1
            FROM lead_tag_assignments lta
            JOIN lead_tags lt ON lt.id = lta.tag_id
            WHERE lta.lead_id    = l.id
              AND lt.company_id  = p_company_id
              AND lt.is_active   = true
              AND lta.tag_id     = ANY(p_tag_ids)
          )
        )
        OR (
          p_tag_mode = 'and'
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(p_tag_ids) AS tid(v)
            WHERE NOT EXISTS (
              SELECT 1
              FROM lead_tag_assignments lta
              JOIN lead_tags lt ON lt.id = lta.tag_id
              WHERE lta.lead_id   = l.id
                AND lta.tag_id    = tid.v
                AND lt.company_id = p_company_id
                AND lt.is_active  = true
            )
          )
        )
      )
      -- Filtro por responsável da oportunidade (complementar à restrição existente).
      -- NULL = sem filtro (comportamento padrão preservado).
      AND (p_owner_user_id IS NULL OR o.owner_user_id = p_owner_user_id)
    ORDER BY
      -- Ordenação dinâmica na paginação (subquery ORDER BY determina
      -- quais registros são selecionados via LIMIT/OFFSET).
      -- Quando p_sort_by IS NULL, CASE retorna NULL para todas as linhas
      -- e o sort cai nos critérios seguintes — idêntico ao comportamento
      -- original: position_in_stage ASC, entered_stage_at DESC NULLS LAST.
      CASE
        WHEN p_sort_by = 'entered_stage_at'    THEN ofp.entered_stage_at
        WHEN p_sort_by = 'entered_funnel_at'   THEN o.created_at
        WHEN p_sort_by = 'lead_created_at'     THEN l.created_at
        WHEN p_sort_by = 'last_interaction_at' THEN l.last_contact_at
        ELSE NULL
      END DESC NULLS LAST,
      ofp.position_in_stage ASC,
      ofp.entered_stage_at  DESC NULLS LAST,
      ofp.id                ASC
    LIMIT  p_limit
    OFFSET p_offset
  ) subq;

  RETURN v_result;
END;
$$;

-- ── GRANT EXECUTE ─────────────────────────────────────────────────────────
-- DROP + CREATE removem GRANTs da assinatura anterior.
-- Reaplicar explicitamente para a nova assinatura de 14 parâmetros.
GRANT EXECUTE ON FUNCTION get_stage_positions_paged(
  UUID, UUID, UUID, TEXT, TEXT, INT, INT, INT, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, UUID
) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════
-- 2. get_funnel_stage_counts (9 → 10 parâmetros)
-- ══════════════════════════════════════════════════════════════════════════

-- ── DROP da assinatura canônica atual (9 params) ─────────────────────────
DROP FUNCTION IF EXISTS get_funnel_stage_counts(
  UUID,         -- p_funnel_id
  UUID,         -- p_company_id
  TEXT,         -- p_search
  TEXT,         -- p_origin
  INT,          -- p_period_days
  UUID[],       -- p_tag_ids
  TEXT,         -- p_tag_mode
  TIMESTAMPTZ,  -- p_start_date
  TIMESTAMPTZ   -- p_end_date
);

-- ── CREATE com 10 parâmetros ──────────────────────────────────────────────
-- Corpo preservado integralmente da migration 20260623450000.
-- Única alteração: novo parâmetro p_owner_user_id + cláusula AND no WHERE.
CREATE OR REPLACE FUNCTION get_funnel_stage_counts(
  p_funnel_id      UUID,
  p_company_id     UUID,
  p_search         TEXT        DEFAULT NULL,
  p_origin         TEXT        DEFAULT NULL,
  p_period_days    INT         DEFAULT NULL,
  p_tag_ids        UUID[]      DEFAULT NULL,
  p_tag_mode       TEXT        DEFAULT 'or',
  p_start_date     TIMESTAMPTZ DEFAULT NULL,
  p_end_date       TIMESTAMPTZ DEFAULT NULL,
  p_owner_user_id  UUID        DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  -- ── Guard: acesso ao funil ────────────────────────────────
  -- Condicional: service_role tem auth.uid() = NULL → não aplicar guard.
  -- Segurança garantida pelo endpoint (valida membership antes de chamar).
  IF auth.uid() IS NOT NULL
     AND NOT auth_user_can_access_funnel(p_company_id, p_funnel_id)
  THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

  -- [CORPO ORIGINAL — 20260611170000_restrict_leads_in_funnel_rpcs.sql]

  IF p_tag_mode NOT IN ('or', 'and') THEN
    RAISE EXCEPTION 'p_tag_mode inválido: %. Use ''or'' ou ''and''.', p_tag_mode;
  END IF;

  -- Guard para service_role: quando auth.uid() IS NULL (contexto backend),
  -- desabilitar a restrição — admin/manager precisam da contagem total.
  -- Segurança garantida pelo endpoint (bloqueia seller; valida membership).
  IF auth.uid() IS NULL THEN
    v_restricted := false;
  ELSE
    v_restricted := auth_user_restricted_to_own_leads(p_company_id);
  END IF;

  SELECT COALESCE(jsonb_agg(stage_data), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'stage_id',    ofp.stage_id,
      'count',       COUNT(*)::int,
      'total_value', COALESCE(SUM(o.value), 0)::numeric
    ) AS stage_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities o ON o.id = ofp.opportunity_id
    JOIN  leads         l ON l.id = o.lead_id
    WHERE ofp.funnel_id  = p_funnel_id
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      -- Restrição por responsável: seller restrito vê apenas seus contadores.
      -- Quando v_restricted = false (service_role ou sem restrição), retorna tudo.
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (
        p_search IS NULL
        OR l.name         ILIKE '%' || p_search || '%'
        OR l.phone        ILIKE '%' || p_search || '%'
        OR l.email        ILIKE '%' || p_search || '%'
        OR l.company_name ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (
        CASE
          WHEN p_start_date IS NOT NULL THEN o.created_at >= p_start_date
          WHEN p_period_days IS NOT NULL THEN o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL
          ELSE TRUE
        END
      )
      AND (p_end_date IS NULL OR o.created_at <= p_end_date)
      AND (
        p_tag_ids IS NULL
        OR cardinality(p_tag_ids) = 0
        OR (
          p_tag_mode = 'or'
          AND EXISTS (
            SELECT 1
            FROM lead_tag_assignments lta
            JOIN lead_tags lt ON lt.id = lta.tag_id
            WHERE lta.lead_id    = l.id
              AND lt.company_id  = p_company_id
              AND lt.is_active   = true
              AND lta.tag_id     = ANY(p_tag_ids)
          )
        )
        OR (
          p_tag_mode = 'and'
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(p_tag_ids) AS tid(v)
            WHERE NOT EXISTS (
              SELECT 1
              FROM lead_tag_assignments lta
              JOIN lead_tags lt ON lt.id = lta.tag_id
              WHERE lta.lead_id   = l.id
                AND lta.tag_id    = tid.v
                AND lt.company_id = p_company_id
                AND lt.is_active  = true
            )
          )
        )
      )
      -- Filtro por responsável da oportunidade (complementar à restrição existente).
      -- NULL = sem filtro (comportamento padrão preservado).
      AND (p_owner_user_id IS NULL OR o.owner_user_id = p_owner_user_id)
    GROUP BY ofp.stage_id
  ) subq;

  RETURN v_result;
END;
$$;

-- ── GRANT EXECUTE ─────────────────────────────────────────────────────────
-- DROP + CREATE removem GRANTs da assinatura anterior.
-- Reaplicar explicitamente para a nova assinatura de 10 parâmetros.
GRANT EXECUTE ON FUNCTION get_funnel_stage_counts(
  UUID, UUID, TEXT, TEXT, INT, UUID[], TEXT, TIMESTAMPTZ, TIMESTAMPTZ, UUID
) TO authenticated;
