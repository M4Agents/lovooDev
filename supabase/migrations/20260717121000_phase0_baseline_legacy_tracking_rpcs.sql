-- =============================================================================
-- Fase 0 / Lote 0B.2 — Baseline das RPCs legadas de tracking
-- =============================================================================
-- Objetivo: versionar no repositório o comportamento LIVE atual destas funções,
--           sem hardening, sem wrappers canônicos e sem mudança de grants.
--
-- Funções:
--   public.public_create_visitor
--   public.public_create_visitor_enhanced
--   public.create_behavior_event
--   public.create_conversion
--   public.get_landing_page_by_tracking_code
--
-- Regras deste lote:
--   * preservar assinaturas, defaults, retornos e semântica live
--   * SECURITY DEFINER mantido; SEM SET search_path (como no live)
--   * SEM GRANT/REVOKE
--   * SEM correção de bugs conhecidos (ex.: SQLERRM, LP inactive no enhanced)
--   * corpos copiados do banco live em 2026-07-17
--
-- Semântica de visitor_id (documentação — não alterar contratos):
--   * public_create_visitor.retorno->>'visitor_id'
--       = visitors.id = visit_id
--   * public_create_visitor_enhanced.retorno->>'visitor_id'
--       = visitors.id = visit_id
--   * public_create_visitor_enhanced.retorno->>'persistent_visitor_id'
--       = visitors.visitor_id = persistent_visitor_id
--   * public_create_visitor_enhanced.param visitor_id_text
--       = persistent_visitor_id (gravado em visitors.visitor_id)
--   * create_behavior_event.visitor_id_param
--       = visitors.id = visit_id (FK behavior_events.visitor_id)
--   * create_conversion.visitor_id_param
--       = visitors.id = visit_id (FK conversions.visitor_id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) public_create_visitor
-- ---------------------------------------------------------------------------
-- Retorno: jsonb { success, visitor_id, landing_page_id }
--   visitor_id = visitors.id (visit_id), NÃO persistent_visitor_id
-- Live: exige landing_pages.status = 'active'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_create_visitor(
  tracking_code_text text,
  session_id_text text,
  user_agent_text text,
  device_type_text text,
  screen_resolution_text text,
  referrer_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  landing_page_id UUID;
  visitor_id UUID;
BEGIN
  -- Buscar landing page
  SELECT id INTO landing_page_id
  FROM landing_pages 
  WHERE tracking_code::text = tracking_code_text
  AND status = 'active'
  LIMIT 1;
  
  IF landing_page_id IS NOT NULL THEN
    -- Inserir visitante diretamente
    INSERT INTO visitors (
      landing_page_id,
      session_id,
      user_agent,
      device_type,
      screen_resolution,
      referrer
    ) VALUES (
      landing_page_id,
      session_id_text::UUID,
      user_agent_text,
      device_type_text,
      screen_resolution_text,
      referrer_text
    ) RETURNING id INTO visitor_id;
    
    RETURN jsonb_build_object(
      'success', true,
      'visitor_id', visitor_id,
      'landing_page_id', landing_page_id
    );
  END IF;
  
  RETURN jsonb_build_object(
    'success', false,
    'error', 'Landing page not found'
  );
END;
$function$;

COMMENT ON FUNCTION public.public_create_visitor(text, text, text, text, text, text) IS
  'LEGACY tracking snapshot (Fase 0 / 0B.2). Returns visitor_id = visitors.id (visit_id). Does not set visitors.visitor_id (persistent).';

-- ---------------------------------------------------------------------------
-- 2) public_create_visitor_enhanced
-- ---------------------------------------------------------------------------
-- Retorno: json { success, visitor_id, persistent_visitor_id }
--   visitor_id            = visitors.id (visit_id)
--   persistent_visitor_id = visitors.visitor_id
-- Param visitor_id_text   = persistent_visitor_id de entrada
-- Live: NÃO filtra status = 'active'; em erro retorna SQLERRM
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.public_create_visitor_enhanced(
  tracking_code_text text,
  session_id_text text,
  visitor_id_text text,
  user_agent_text text,
  device_type_text text,
  screen_resolution_text text,
  referrer_text text,
  timezone_text text,
  language_text text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  landing_page_uuid UUID;
  visitor_uuid UUID;
  session_uuid UUID;
  visitor_id_uuid UUID;
  result JSON;
BEGIN
  -- Find landing page by tracking code (cast to UUID)
  SELECT id INTO landing_page_uuid 
  FROM landing_pages 
  WHERE tracking_code::text = tracking_code_text;
  
  IF landing_page_uuid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Invalid tracking code');
  END IF;
  
  -- Validate and convert session_id
  BEGIN
    session_uuid := session_id_text::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    session_uuid := gen_random_uuid();
  END;
  
  -- Validate and convert visitor_id (can be null)
  IF visitor_id_text IS NOT NULL AND visitor_id_text != '' THEN
    BEGIN
      visitor_id_uuid := visitor_id_text::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      visitor_id_uuid := gen_random_uuid();
    END;
  ELSE
    visitor_id_uuid := gen_random_uuid();
  END IF;
  
  -- Insert visitor with all remarketing data
  INSERT INTO visitors (
    id,
    landing_page_id,
    session_id,
    visitor_id,
    user_agent,
    device_type,
    screen_resolution,
    referrer,
    timezone,
    language,
    created_at
  ) VALUES (
    gen_random_uuid(),
    landing_page_uuid,
    session_uuid,
    visitor_id_uuid,
    user_agent_text,
    device_type_text,
    screen_resolution_text,
    referrer_text,
    timezone_text,
    language_text,
    NOW()
  ) RETURNING id INTO visitor_uuid;
  
  RETURN json_build_object(
    'success', true, 
    'visitor_id', visitor_uuid,
    'persistent_visitor_id', visitor_id_uuid
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

COMMENT ON FUNCTION public.public_create_visitor_enhanced(text, text, text, text, text, text, text, text, text) IS
  'LEGACY tracking snapshot (Fase 0 / 0B.2). Returns visitor_id = visitors.id (visit_id) and persistent_visitor_id = visitors.visitor_id. Param visitor_id_text is persistent_visitor_id.';

-- ---------------------------------------------------------------------------
-- 3) create_behavior_event
-- ---------------------------------------------------------------------------
-- Param visitor_id_param = visitors.id (visit_id) → FK behavior_events.visitor_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_behavior_event(
  visitor_id_param uuid,
  event_type_param text,
  event_data_param jsonb DEFAULT '{}'::jsonb,
  coordinates_param jsonb DEFAULT NULL::jsonb,
  element_selector_param text DEFAULT NULL::text,
  section_param text DEFAULT NULL::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO behavior_events (
    visitor_id,
    event_type,
    event_data,
    coordinates,
    element_selector,
    section
  ) VALUES (
    visitor_id_param,
    event_type_param,
    event_data_param,
    coordinates_param,
    element_selector_param,
    section_param
  );
  
  RETURN TRUE;
END;
$function$;

COMMENT ON FUNCTION public.create_behavior_event(uuid, text, jsonb, jsonb, text, text) IS
  'LEGACY tracking snapshot (Fase 0 / 0B.2). visitor_id_param = visitors.id (visit_id), FK to behavior_events.visitor_id.';

-- ---------------------------------------------------------------------------
-- 4) create_conversion
-- ---------------------------------------------------------------------------
-- Param visitor_id_param = visitors.id (visit_id) → FK conversions.visitor_id
-- Live: NÃO valida visitors.landing_page_id = landing_page_id_param
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_conversion(
  visitor_id_param uuid,
  landing_page_id_param uuid,
  form_data_param jsonb,
  behavior_summary_param jsonb,
  engagement_score_param numeric DEFAULT 0,
  time_to_convert_param integer DEFAULT 0
)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  conversion_id UUID;
BEGIN
  INSERT INTO conversions (
    visitor_id,
    landing_page_id,
    form_data,
    behavior_summary,
    engagement_score,
    time_to_convert
  ) VALUES (
    visitor_id_param,
    landing_page_id_param,
    form_data_param,
    behavior_summary_param,
    engagement_score_param,
    time_to_convert_param
  ) RETURNING conversions.id INTO conversion_id;
  
  RETURN QUERY SELECT conversion_id;
END;
$function$;

COMMENT ON FUNCTION public.create_conversion(uuid, uuid, jsonb, jsonb, numeric, integer) IS
  'LEGACY tracking snapshot (Fase 0 / 0B.2). visitor_id_param = visitors.id (visit_id), FK to conversions.visitor_id. Does not validate visit/landing_page consistency.';

-- ---------------------------------------------------------------------------
-- 5) get_landing_page_by_tracking_code
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_landing_page_by_tracking_code(
  tracking_code_param uuid
)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT lp.id
  FROM landing_pages lp
  WHERE lp.tracking_code = tracking_code_param
    AND lp.status = 'active';
END;
$function$;

COMMENT ON FUNCTION public.get_landing_page_by_tracking_code(uuid) IS
  'LEGACY tracking snapshot (Fase 0 / 0B.2). Returns active landing_pages.id by tracking_code.';

-- Grants NÃO alterados neste lote (preservar EXECUTE live para anon/authenticated/service_role).
-- Hardening de search_path / wrappers canônicos → lotes 0B.3+.
