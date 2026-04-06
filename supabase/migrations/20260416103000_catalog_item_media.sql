-- =====================================================
-- Mídias estruturadas do catálogo (produtos/serviços)
-- Vínculo a company_media_library (sem duplicação no S3)
-- Multi-tenant, RLS, XOR produto/serviço, RESTRICT no asset
-- =====================================================

DO $$ BEGIN
  CREATE TYPE catalog_media_usage_role AS ENUM (
    'presentation',
    'demo',
    'proof',
    'testimonial',
    'before_after'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS catalog_item_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id UUID NULL REFERENCES products(id) ON DELETE CASCADE,
  service_id UUID NULL REFERENCES services(id) ON DELETE CASCADE,
  library_asset_id UUID NOT NULL REFERENCES company_media_library(id) ON DELETE RESTRICT,
  media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
  usage_role catalog_media_usage_role NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  use_in_ai BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT catalog_item_media_target_xor CHECK (
    (product_id IS NOT NULL AND service_id IS NULL)
    OR (product_id IS NULL AND service_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_catalog_item_media_company_product
  ON catalog_item_media (company_id, product_id)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_item_media_company_service
  ON catalog_item_media (company_id, service_id)
  WHERE service_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_item_media_library_asset
  ON catalog_item_media (library_asset_id);

CREATE INDEX IF NOT EXISTS idx_catalog_item_media_company_usage
  ON catalog_item_media (company_id, usage_role);

-- Mesmo item + mesmo asset + mesma função comercial: uma linha
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_item_media_product_asset_role
  ON catalog_item_media (company_id, product_id, library_asset_id, usage_role)
  WHERE product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_catalog_item_media_service_asset_role
  ON catalog_item_media (company_id, service_id, library_asset_id, usage_role)
  WHERE service_id IS NOT NULL;

COMMENT ON TABLE catalog_item_media IS
  'Vínculo de mídia da biblioteca (company_media_library) a produto ou serviço; semântica de uso comercial e IA.';

DROP TRIGGER IF EXISTS update_catalog_item_media_updated_at ON catalog_item_media;
CREATE TRIGGER update_catalog_item_media_updated_at
  BEFORE UPDATE ON catalog_item_media
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------
-- Trigger: coerência de company_id (produto/serviço/asset) + tipo de arquivo
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_validate_catalog_item_media_company()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pc UUID;
  v_sc UUID;
  v_ac UUID;
  v_ft TEXT;
BEGIN
  IF NEW.product_id IS NOT NULL THEN
    SELECT company_id INTO v_pc FROM products WHERE id = NEW.product_id;
    IF v_pc IS NULL THEN
      RAISE EXCEPTION 'Produto inválido.';
    END IF;
    IF v_pc IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Produto não pertence à empresa do vínculo.';
    END IF;
  END IF;

  IF NEW.service_id IS NOT NULL THEN
    SELECT company_id INTO v_sc FROM services WHERE id = NEW.service_id;
    IF v_sc IS NULL THEN
      RAISE EXCEPTION 'Serviço inválido.';
    END IF;
    IF v_sc IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'Serviço não pertence à empresa do vínculo.';
    END IF;
  END IF;

  SELECT company_id, file_type INTO v_ac, v_ft
  FROM company_media_library
  WHERE id = NEW.library_asset_id;

  IF v_ac IS NULL THEN
    RAISE EXCEPTION 'Asset da biblioteca inválido.';
  END IF;
  IF v_ac IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'Asset da biblioteca não pertence à empresa do vínculo.';
  END IF;
  IF v_ft IS NULL OR v_ft NOT IN ('image', 'video') THEN
    RAISE EXCEPTION 'Apenas imagens e vídeos podem ser vinculados ao catálogo.';
  END IF;
  IF NEW.media_type IS DISTINCT FROM v_ft THEN
    RAISE EXCEPTION 'media_type deve corresponder ao tipo do arquivo na biblioteca.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_item_media_company ON catalog_item_media;
CREATE TRIGGER trg_catalog_item_media_company
  BEFORE INSERT OR UPDATE ON catalog_item_media
  FOR EACH ROW EXECUTE FUNCTION trg_validate_catalog_item_media_company();

-- -----------------------------------------------------------------
-- RLS (mesmo padrão de products/services/catalog_item_relations)
-- -----------------------------------------------------------------
ALTER TABLE catalog_item_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_item_media_select ON catalog_item_media;
DROP POLICY IF EXISTS catalog_item_media_insert ON catalog_item_media;
DROP POLICY IF EXISTS catalog_item_media_update ON catalog_item_media;
DROP POLICY IF EXISTS catalog_item_media_delete ON catalog_item_media;

CREATE POLICY catalog_item_media_select ON catalog_item_media FOR SELECT USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_item_media_insert ON catalog_item_media FOR INSERT WITH CHECK (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_item_media_update ON catalog_item_media FOR UPDATE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);
CREATE POLICY catalog_item_media_delete ON catalog_item_media FOR DELETE USING (
  company_id IN (SELECT company_id FROM company_users WHERE user_id = auth.uid())
);

-- -----------------------------------------------------------------
-- RPC: leitura consolidada (SECURITY INVOKER — respeita RLS)
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_catalog_item_media(
  p_company_id UUID,
  p_product_id UUID DEFAULT NULL,
  p_service_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  company_id UUID,
  product_id UUID,
  service_id UUID,
  library_asset_id UUID,
  media_type TEXT,
  usage_role catalog_media_usage_role,
  sort_order INT,
  is_active BOOLEAN,
  use_in_ai BOOLEAN,
  metadata JSONB,
  s3_key TEXT,
  preview_url TEXT,
  original_filename TEXT,
  library_file_type TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    (p_product_id IS NOT NULL AND p_service_id IS NULL)
    OR (p_product_id IS NULL AND p_service_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'Informe exatamente um de p_product_id ou p_service_id';
  END IF;

  RETURN QUERY
  SELECT
    m.id,
    m.company_id,
    m.product_id,
    m.service_id,
    m.library_asset_id,
    m.media_type,
    m.usage_role,
    m.sort_order,
    m.is_active,
    m.use_in_ai,
    m.metadata,
    cml.s3_key,
    cml.preview_url,
    cml.original_filename,
    cml.file_type AS library_file_type
  FROM catalog_item_media m
  INNER JOIN company_media_library cml ON cml.id = m.library_asset_id
  WHERE m.company_id = p_company_id
    AND (
      (p_product_id IS NOT NULL AND m.product_id = p_product_id AND m.service_id IS NULL)
      OR (p_service_id IS NOT NULL AND m.service_id = p_service_id AND m.product_id IS NULL)
    )
  ORDER BY m.sort_order ASC, m.created_at ASC;
END;
$$;

COMMENT ON FUNCTION get_catalog_item_media(UUID, UUID, UUID) IS
  'Lista mídias do catálogo com dados do asset da biblioteca; uso futuro pelo agente de IA.';

GRANT EXECUTE ON FUNCTION get_catalog_item_media(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_catalog_item_media(UUID, UUID, UUID) TO service_role;
