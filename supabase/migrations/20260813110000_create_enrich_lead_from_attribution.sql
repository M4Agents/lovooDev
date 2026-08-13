-- =============================================================================
-- NubeSDK Attribution — RPC interna de enrichment de leads
--
-- Chamada pelo backend (customerSync / checkoutSync) via service_role
-- após consumir um conversion_signal bem-sucedido.
--
-- Decisão SECURITY DEFINER:
--   Usada para seguir o padrão do projeto (consume_conversion_signal_for_lead,
--   public_create_conversion_signal) e garantir que nenhuma role diferente de
--   service_role possa invocar esta função, mesmo que obtenha acesso direto
--   ao PostgREST. REVOKE ALL impede execução por anon/authenticated.
--
-- Mapeamento de campos UTM (colunas reais da tabela leads):
--   utm_source       → leads.utm_source
--   utm_medium       → leads.utm_medium
--   utm_campaign     → leads.campanha
--   utm_content      → leads.conjunto_anuncio
--   utm_term         → leads.anuncio
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enrich_lead_from_attribution(
  p_lead_id               integer,
  p_company_id            uuid,
  p_persistent_visitor_id uuid,
  p_signal_id             uuid DEFAULT NULL
)
RETURNS TABLE (success boolean, error_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_visitor  text;
  v_needs_visitor     boolean;
  v_utm_source        text;
  v_utm_medium        text;
  v_utm_campaign      text;
  v_utm_content       text;
  v_utm_term          text;
BEGIN
  -- Validação básica de parâmetros
  IF p_lead_id IS NULL OR p_company_id IS NULL OR p_persistent_visitor_id IS NULL THEN
    success := false; error_code := 'INVALID_PARAMS';
    RETURN NEXT; RETURN;
  END IF;

  -- Buscar visitor_id atual do lead (valida tenant ao mesmo tempo)
  SELECT l.visitor_id INTO v_existing_visitor
  FROM public.leads l
  WHERE l.id = p_lead_id
    AND l.company_id = p_company_id
    AND l.deleted_at IS NULL;

  IF NOT FOUND THEN
    success := false; error_code := 'LEAD_NOT_FOUND';
    RETURN NEXT; RETURN;
  END IF;

  -- Determinar se o lead precisa de atribuição de visitor_id
  v_needs_visitor := v_existing_visitor IS NULL OR BTRIM(v_existing_visitor) = '';

  -- Atualizar visitor_id somente quando ausente (guarda atômica)
  IF v_needs_visitor THEN
    UPDATE public.leads
    SET visitor_id = p_persistent_visitor_id::text,
        updated_at = NOW()
    WHERE id = p_lead_id
      AND company_id = p_company_id
      AND (visitor_id IS NULL OR BTRIM(visitor_id) = '');
    -- WHERE garante atomicidade em caso de concorrência
  END IF;

  -- Buscar first-touch UTMs do visitor (primeira visita com pelo menos 1 UTM)
  SELECT
    vis.utm_source,
    vis.utm_medium,
    vis.utm_campaign,
    vis.utm_content,
    vis.utm_term
  INTO
    v_utm_source,
    v_utm_medium,
    v_utm_campaign,
    v_utm_content,
    v_utm_term
  FROM public.visitors vis
  WHERE vis.visitor_id = p_persistent_visitor_id
    AND (
      vis.utm_source   IS NOT NULL OR vis.utm_medium   IS NOT NULL OR
      vis.utm_campaign IS NOT NULL OR vis.utm_content  IS NOT NULL OR
      vis.utm_term     IS NOT NULL
    )
  ORDER BY vis.created_at ASC   -- first-touch (igual ao public_create_conversion_signal)
  LIMIT 1;

  -- Preencher UTMs ausentes no lead com COALESCE (nunca sobrescreve valores existentes)
  -- Mapeamento: campanha←utm_campaign, conjunto_anuncio←utm_content, anuncio←utm_term
  UPDATE public.leads l
  SET
    utm_source       = COALESCE(l.utm_source,       v_utm_source),
    utm_medium       = COALESCE(l.utm_medium,       v_utm_medium),
    campanha         = COALESCE(l.campanha,         v_utm_campaign),
    conjunto_anuncio = COALESCE(l.conjunto_anuncio, v_utm_content),
    anuncio          = COALESCE(l.anuncio,          v_utm_term),
    updated_at       = NOW()
  WHERE l.id = p_lead_id
    AND l.company_id = p_company_id;

  -- Retorno: sucesso independente de haver atribuído ou não (idempotente)
  success    := true;
  error_code := CASE WHEN v_needs_visitor THEN NULL ELSE 'ALREADY_ATTRIBUTED' END;
  RETURN NEXT;
  RETURN;

EXCEPTION
  WHEN OTHERS THEN
    success := false; error_code := 'INTERNAL_ERROR';
    RETURN NEXT; RETURN;
END;
$$;

COMMENT ON FUNCTION public.enrich_lead_from_attribution(integer, uuid, uuid, uuid) IS
  'Enriquece lead com visitor_id e UTMs após consumo de conversion_signal.
   Atualiza visitor_id somente se ausente (IS NULL OR BTRIM = '''').
   Preenche UTMs com COALESCE — nunca sobrescreve valores existentes.
   Mapeamento: campanha←utm_campaign, conjunto_anuncio←utm_content, anuncio←utm_term.
   Acesso exclusivo via service_role. Chamada por customerSync e checkoutSync.';

-- Sem acesso para roles públicas — exclusivo service_role
REVOKE ALL ON FUNCTION public.enrich_lead_from_attribution(integer, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enrich_lead_from_attribution(integer, uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.enrich_lead_from_attribution(integer, uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.enrich_lead_from_attribution(integer, uuid, uuid, uuid) TO service_role;
