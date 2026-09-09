-- =====================================================
-- MIGRATION: add_responsible_to_funnel_positions
-- Data: 09/09/2026
-- Objetivo: Incluir responsible_user_id (responsável pelo lead)
--           no JSON retornado pela RPC get_funnel_positions_with_photos.
--           Permite exibir o responsável como campo opcional no card do Kanban.
--
-- RPC alterada:
--   1. get_funnel_positions_with_photos
--      Base: 20260807210000_add_opportunity_number_to_rpcs.sql (versão vigente)
--      Mudança: adição de 'responsible_user_id', l.responsible_user_id
--               ao jsonb_build_object do lead — última posição do objeto.
--
-- A assinatura NÃO muda. Usar CREATE OR REPLACE sem DROP.
-- Compatibilidade: campo aditivo — clientes sem a preferência ignoram o campo.
--
-- Masking de is_over_plan: NÃO aplicado a responsible_user_id.
--   responsible_user_id é um UUID interno de usuário do sistema,
--   não um dado sensível do lead (como email ou phone).
--
-- Preservado integralmente:
--   - Assinatura (6 parâmetros com defaults)
--   - STABLE, SECURITY DEFINER, SET search_path = public
--   - Guard auth_user_can_access_funnel
--   - v_restricted (seller restriction por responsible_user_id)
--   - is_over_plan masking (email/phone nullados)
--   - reentry_count via subquery em opportunity_stage_history
--   - opportunity_number, value_mode, items_subtotal, discount_type, discount_value
--   - JOIN via l.phone_normalized (não regex)
--   - Filtros p_search, p_origin, p_period_days, p_stage_id
--   - Ordenação por position_in_stage ASC
-- =====================================================

SET search_path = public;

CREATE OR REPLACE FUNCTION get_funnel_positions_with_photos(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_stage_id    UUID    DEFAULT NULL,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result     JSONB;
  v_restricted BOOLEAN;
BEGIN
  -- ── Guard: acesso ao funil ────────────────────────────────────────────
  IF NOT auth_user_can_access_funnel(p_company_id, p_funnel_id) THEN
    RAISE EXCEPTION 'UNAUTHORIZED: usuário não tem acesso ao funil %', p_funnel_id;
  END IF;

  -- Calcular restrição uma única vez para toda a query.
  -- auth.uid() sempre presente neste contexto (frontend JWT).
  v_restricted := auth_user_restricted_to_own_leads(p_company_id);

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
      'reentry_count',     COALESCE(rc.reentry_count, 0),
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
        'value_mode',          o.value_mode,
        'items_subtotal',      o.items_subtotal,
        'discount_type',       o.discount_type,
        'discount_value',      o.discount_value,
        'opportunity_number',  o.opportunity_number,
        'lead', jsonb_build_object(
          'id',                  l.id,
          'name',                l.name,
          'is_over_plan',        l.is_over_plan,
          -- Campos sensíveis mascarados no banco para leads restritos pelo plano
          'email',               CASE WHEN l.is_over_plan THEN NULL ELSE l.email END,
          'phone',               CASE WHEN l.is_over_plan THEN NULL ELSE l.phone END,
          'company_name',        l.company_name,
          'created_at',          l.created_at,
          'origin',              l.origin,
          'status',              l.status,
          'record_type',         l.record_type,
          'last_contact_at',     l.last_contact_at,
          'profile_picture_url', cc.profile_picture_url,
          'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb),
          -- Responsável pelo lead: UUID do usuário atribuído via "Atribuir Responsável".
          -- Não é dado sensível do lead — masking de is_over_plan não se aplica.
          'responsible_user_id', l.responsible_user_id
        )
      )
    ) AS row_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities  o  ON o.id  = ofp.opportunity_id
    JOIN  leads          l  ON l.id  = o.lead_id
    LEFT JOIN chat_contacts cc ON
      l.phone_normalized = cc.phone_number
      AND l.company_id   = cc.company_id
    LEFT JOIN (
      SELECT opportunity_id, COUNT(*) AS reentry_count
      FROM opportunity_stage_history
      WHERE move_type  = 'lead_reentry'
        AND company_id = p_company_id
      GROUP BY opportunity_id
    ) rc ON rc.opportunity_id = ofp.opportunity_id
    LEFT JOIN LATERAL (
      SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
      FROM   chat_conversations cv
      WHERE  cv.contact_phone = l.phone_normalized
        AND  cv.company_id    = l.company_id
      ORDER  BY cv.last_message_at DESC NULLS LAST
      LIMIT  1
    ) conv ON true
    WHERE ofp.funnel_id  = p_funnel_id
      AND o.company_id   = p_company_id
      AND l.deleted_at   IS NULL
      -- Restrição por responsável: seller restrito vê apenas seus leads.
      AND (
        NOT v_restricted
        OR l.responsible_user_id = auth.uid()
      )
      AND (p_stage_id    IS NULL OR ofp.stage_id = p_stage_id)
      AND (
        p_search IS NULL
        OR l.name  ILIKE '%' || p_search || '%'
        OR l.phone ILIKE '%' || p_search || '%'
        OR l.email ILIKE '%' || p_search || '%'
      )
      AND (p_origin IS NULL OR l.origin = p_origin)
      AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
  ) subq;

  RETURN v_result;
END;
$$;
