-- =============================================================================
-- get_product_category_path(p_product_id)
--
-- Retorna o caminho completo de categorias de um produto para uso pelo agente de IA.
--
-- Formato de retorno:
--   [
--     "Pulseiras > Bracelete > Aço Inoxidável",
--     "Pulseiras > Bracelete > Vintage"
--   ]
--
-- Cada elemento do array é um caminho da raiz até a categoria folha,
-- permitindo ao agente identificar tipo de produto e todos os seus atributos.
--
-- Usado por: agente de IA, contexto de lead, contexto de oportunidade.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_product_category_path(p_product_id uuid)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id   uuid;
  v_category_ids uuid[];
  v_paths        text[] := '{}';
  v_cat_id       uuid;
  v_path         text;
  v_current_id   uuid;
  v_current_name text;
  v_parent_id    uuid;
  v_parts        text[];
BEGIN
  -- Recuperar empresa e categorias do produto
  SELECT company_id, category_ids
  INTO v_company_id, v_category_ids
  FROM public.products
  WHERE id = p_product_id;

  IF v_company_id IS NULL OR v_category_ids IS NULL THEN
    RETURN '{}';
  END IF;

  -- Para cada categoria, montar o caminho da raiz até o nó folha
  FOREACH v_cat_id IN ARRAY v_category_ids LOOP
    v_parts      := '{}';
    v_current_id := v_cat_id;

    -- Percorrer a hierarquia até a raiz (máximo 10 níveis para evitar loop infinito)
    FOR i IN 1..10 LOOP
      SELECT name, parent_id
      INTO v_current_name, v_parent_id
      FROM public.catalog_categories
      WHERE id = v_current_id
        AND company_id = v_company_id;

      EXIT WHEN NOT FOUND;

      -- Prepend: inserir no início do array (raiz primeiro)
      v_parts      := array_prepend(v_current_name, v_parts);
      v_current_id := v_parent_id;

      EXIT WHEN v_parent_id IS NULL;
    END LOOP;

    IF array_length(v_parts, 1) > 0 THEN
      v_path  := array_to_string(v_parts, ' > ');
      -- Evitar duplicatas no resultado
      IF NOT (v_path = ANY(v_paths)) THEN
        v_paths := array_append(v_paths, v_path);
      END IF;
    END IF;
  END LOOP;

  RETURN v_paths;
END;
$$;

COMMENT ON FUNCTION public.get_product_category_path(uuid) IS
  'Retorna array de caminhos de categorias de um produto (ex: ["Pulseiras > Bracelete > Aço Inoxidável"]). Usado pelo agente de IA.';
