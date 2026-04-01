-- =====================================================
-- MIGRATION: Regra de posicionamento no topo do funil
-- Data: 05/04/2026
-- Objetivo:
--   1. Garantir que toda nova oportunidade inserida em
--      opportunity_funnel_positions entre automaticamente
--      na posição 0 da etapa, deslocando as demais para baixo.
--   2. Estabilizar a ordenação das RPCs do board com
--      desempate secundário por entered_stage_at para
--      dados legados com position_in_stage duplicado.
--
-- CAMINHOS COBERTOS AUTOMATICAMENTE:
--   - webhook: create_lead_from_whatsapp_safe (INSERT direto)
--   - frontend: addOpportunityToFunnel via funnelApi.ts (INSERT direto)
--   - legado: useLeadPositions.addLeadToFunnel (INSERT via funnelApi)
--   - futuros fluxos que insiram em opportunity_funnel_positions
--
-- GARANTIAS:
--   - DnD não é afetado: moveOpportunityToStage faz UPDATE, não INSERT
--   - Trigger de histórico não é afetado: record_lead_stage_movement()
--     só registra quando OLD.stage_id != NEW.stage_id. O shift altera
--     apenas position_in_stage — stage_id permanece igual.
--   - Realtime (Fase 4): INSERT continua gerando evento INSERT,
--     tratado por useFunnelRealtime → boardRefresh(stage_id)
--   - Contadores: position_in_stage não afeta count/total_value
--   - Isolamento multi-tenant: shift filtrado por funnel_id + stage_id;
--     um funnel pertence a uma única empresa.
--
-- ROLLBACK SEGURO:
--   DROP TRIGGER shift_positions_before_opportunity_insert
--     ON opportunity_funnel_positions;
--   DROP FUNCTION shift_positions_on_opportunity_insert();
--   Dados existentes não são afetados. RPCs: restaurar ORDER BY original.
-- =====================================================


-- =====================================================
-- PARTE 1: FUNÇÃO + TRIGGER DE SHIFT DE POSIÇÃO
-- =====================================================

CREATE OR REPLACE FUNCTION shift_positions_on_opportunity_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Desloca todas as oportunidades da mesma etapa e funil.
  -- O shift é limitado a funnel_id + stage_id para garantir
  -- isolamento entre tenants e entre etapas distintas.
  UPDATE opportunity_funnel_positions
  SET    position_in_stage = position_in_stage + 1
  WHERE  funnel_id = NEW.funnel_id
    AND  stage_id  = NEW.stage_id;

  -- Força position 0 independentemente do valor passado pelo caller.
  -- Mesmo que addOpportunityToFunnel passe position_in_stage = 0,
  -- este ponto garante consistência para qualquer caller futuro.
  NEW.position_in_stage := 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shift_positions_before_opportunity_insert
  BEFORE INSERT ON opportunity_funnel_positions
  FOR EACH ROW
  EXECUTE FUNCTION shift_positions_on_opportunity_insert();


-- =====================================================
-- PARTE 2: get_stage_positions_paged — ORDER BY estabilizado
-- =====================================================
-- Assinatura confirmada no banco (8 parâmetros, sem overload):
--   p_funnel_id, p_stage_id, p_company_id, p_search,
--   p_origin, p_period_days, p_limit, p_offset
--
-- Mudança: adiciona desempate secundário
--   entered_stage_at DESC NULLS LAST
-- no inner ORDER BY (controla LIMIT/OFFSET) e no jsonb_agg.
-- A regra primária position_in_stage ASC permanece inalterada.
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
    jsonb_agg(
      row_data
      ORDER BY
        (row_data->>'position_in_stage')::int        ASC,
        (row_data->>'entered_stage_at')::timestamptz DESC NULLS LAST
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
    -- Regra primária: position_in_stage ASC
    -- Desempate secundário: entered_stage_at DESC NULLS LAST
    -- (dados legados com mesmo position_in_stage: o mais recente aparece primeiro)
    ORDER BY ofp.position_in_stage ASC, ofp.entered_stage_at DESC NULLS LAST
    LIMIT  p_limit
    OFFSET p_offset
  ) subq;

  RETURN v_result;
END;
$$;


-- =====================================================
-- PARTE 3: get_funnel_positions_with_photos — ORDER BY estabilizado
-- =====================================================
-- Assinatura confirmada no banco (6 parâmetros, sem overload):
--   p_funnel_id, p_company_id, p_stage_id,
--   p_search, p_origin, p_period_days
--
-- Mesma estratégia: desempate secundário entered_stage_at DESC NULLS LAST.
-- Esta RPC é o fallback da Fase 2 (fetch sem paginação por coluna).
-- =====================================================

CREATE OR REPLACE FUNCTION get_funnel_positions_with_photos(
  p_funnel_id   UUID,
  p_company_id  UUID,
  p_stage_id    UUID    DEFAULT NULL,
  p_search      TEXT    DEFAULT NULL,
  p_origin      TEXT    DEFAULT NULL,
  p_period_days INT     DEFAULT NULL
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
    jsonb_agg(
      row_data
      ORDER BY
        (row_data->>'position_in_stage')::int        ASC,
        (row_data->>'entered_stage_at')::timestamptz DESC NULLS LAST
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
          'chat_conversations',  COALESCE(conv.conversations, '[]'::jsonb)
        )
      )
    ) AS row_data
    FROM opportunity_funnel_positions ofp
    JOIN  opportunities  o  ON o.id  = ofp.opportunity_id
    JOIN  leads          l  ON l.id  = o.lead_id
    -- Foto: usa phone_normalized (sargable) em vez de REGEXP_REPLACE inline
    LEFT JOIN chat_contacts cc ON
      l.phone_normalized = cc.phone_number
      AND l.company_id   = cc.company_id
    -- Conversa mais recente (usa phone_normalized no filtro)
    LEFT JOIN LATERAL (
      SELECT jsonb_build_array(jsonb_build_object('id', cv.id)) AS conversations
      FROM   chat_conversations cv
      WHERE  cv.contact_phone = l.phone_normalized
        AND  cv.company_id    = l.company_id
      ORDER  BY cv.last_message_at DESC NULLS LAST
      LIMIT  1
    ) conv ON true
    WHERE ofp.funnel_id  = p_funnel_id
      AND o.company_id   = p_company_id  -- ISOLAMENTO MULTI-TENANT
      AND l.deleted_at   IS NULL
      AND (p_stage_id    IS NULL OR ofp.stage_id = p_stage_id)
      -- Filtro de busca textual (nome, telefone ou e-mail)
      AND (
        p_search IS NULL
        OR l.name  ILIKE '%' || p_search || '%'
        OR l.phone ILIKE '%' || p_search || '%'
        OR l.email ILIKE '%' || p_search || '%'
      )
      -- Filtro de origem exata
      AND (p_origin IS NULL OR l.origin = p_origin)
      -- Filtro de período: oportunidades criadas nos últimos N dias
      AND (p_period_days IS NULL OR o.created_at >= NOW() - (p_period_days || ' days')::INTERVAL)
  ) subq;

  RETURN v_result;
END;
$$;
