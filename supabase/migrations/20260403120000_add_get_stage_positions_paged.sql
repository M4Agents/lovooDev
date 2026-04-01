-- =====================================================
-- MIGRATION: get_stage_positions_paged
-- Data: 03/04/2026
-- Objetivo: RPC paginada para carregar posições de uma única
--           etapa do funil. Substitui o fetch global por
--           carregamento por coluna com LIMIT/OFFSET.
--
-- Parâmetros obrigatórios:
--   p_funnel_id   UUID  — double-check de isolamento (stage + funnel)
--   p_stage_id    UUID  — etapa a ser carregada
--   p_company_id  UUID  — isolamento multi-tenant
--
-- Parâmetros opcionais (filtros server-side da Fase 2):
--   p_search      TEXT  — busca por nome, telefone ou email
--   p_origin      TEXT  — filtro exato por leads.origin
--   p_period_days INT   — oportunidades criadas nos últimos N dias
--   p_limit       INT   — tamanho da página (padrão 20)
--   p_offset      INT   — deslocamento para paginação (padrão 0)
--
-- Segurança:
--   WHERE usa p_funnel_id + p_stage_id + p_company_id como
--   tripla barreira de isolamento. p_funnel_id evita ambiguidade
--   caso stages sejam reutilizadas em múltiplos funis no futuro.
-- =====================================================

CREATE OR REPLACE FUNCTION get_stage_positions_paged(
  p_funnel_id   UUID,
  p_stage_id    UUID,
  p_company_id  UUID,
  p_search      TEXT DEFAULT NULL,
  p_origin      TEXT DEFAULT NULL,
  p_period_days INT  DEFAULT NULL,
  p_limit       INT  DEFAULT 20,
  p_offset      INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  SELECT COALESCE(
    jsonb_agg(row_data ORDER BY (row_data->>'position_in_stage')::int ASC),
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
          'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb)
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
      AND o.company_id   = p_company_id  -- ISOLAMENTO MULTI-TENANT
      AND l.deleted_at   IS NULL
      AND (
        p_search IS NULL
        OR l.name  ILIKE '%' || p_search || '%'
        OR l.phone ILIKE '%' || p_search || '%'
        OR l.email ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
    ORDER BY ofp.position_in_stage ASC
    LIMIT  p_limit
    OFFSET p_offset
  ) subq;

  RETURN v_result;
END;
$$;
