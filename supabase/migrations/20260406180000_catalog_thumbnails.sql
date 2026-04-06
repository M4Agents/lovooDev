-- =====================================================
-- RPC batch para thumbnails do catálogo na listagem
-- Retorna a primeira imagem ativa (menor sort_order) de cada produto ou serviço.
-- SECURITY INVOKER — respeita RLS de catalog_item_media e company_media_library.
-- =====================================================

-- Índices parciais otimizados para DISTINCT ON + ORDER BY sort_order
CREATE INDEX IF NOT EXISTS idx_catalog_item_media_product_thumb
  ON catalog_item_media (company_id, product_id, sort_order)
  WHERE product_id IS NOT NULL
    AND is_active  = true
    AND media_type = 'image';

CREATE INDEX IF NOT EXISTS idx_catalog_item_media_service_thumb
  ON catalog_item_media (company_id, service_id, sort_order)
  WHERE service_id IS NOT NULL
    AND is_active  = true
    AND media_type = 'image';

-- RPC
CREATE OR REPLACE FUNCTION get_catalog_thumbnails(
  p_company_id uuid,
  p_type       text  -- 'product' | 'service'
)
RETURNS TABLE (item_id uuid, preview_url text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_type = 'product' THEN
    RETURN QUERY
    SELECT DISTINCT ON (cim.product_id)
      cim.product_id        AS item_id,
      cml.preview_url
    FROM catalog_item_media cim
    JOIN company_media_library cml ON cml.id = cim.library_asset_id
    WHERE cim.company_id = p_company_id
      AND cim.media_type = 'image'
      AND cim.is_active  = true
      AND cim.product_id IS NOT NULL
    ORDER BY cim.product_id, cim.sort_order ASC;

  ELSIF p_type = 'service' THEN
    RETURN QUERY
    SELECT DISTINCT ON (cim.service_id)
      cim.service_id        AS item_id,
      cml.preview_url
    FROM catalog_item_media cim
    JOIN company_media_library cml ON cml.id = cim.library_asset_id
    WHERE cim.company_id = p_company_id
      AND cim.media_type = 'image'
      AND cim.is_active  = true
      AND cim.service_id IS NOT NULL
    ORDER BY cim.service_id, cim.sort_order ASC;

  ELSE
    RAISE EXCEPTION 'p_type deve ser "product" ou "service"';
  END IF;
END;
$$;

COMMENT ON FUNCTION get_catalog_thumbnails(uuid, text) IS
  'Retorna a primeira imagem ativa (menor sort_order) de cada produto ou serviço da empresa; usado na listagem do catálogo.';

GRANT EXECUTE ON FUNCTION get_catalog_thumbnails(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_catalog_thumbnails(uuid, text) TO service_role;
