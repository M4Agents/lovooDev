-- =============================================================================
-- MIGRATION: automation_manage_opportunity_items_v1 + helpers internos
-- Data: 13/07/2026
-- Estratégia: A (aditiva — sem modificar RPCs existentes)
--
-- CONTEXTO
-- --------
-- O motor de automação (executor.js) usa service_role para acessar o banco.
-- Quando chamado com service_role, auth.uid() retorna NULL.
-- As RPCs existentes de itens (opportunity_add_item, opportunity_sync_totals,
-- opportunity_remove_item) chamam company_user_has_access() que usa auth.uid().
-- Com auth.uid() = NULL, essas RPCs retornam OPP_OPPORTUNITY_ACCESS_DENIED.
-- Por isso, novas funções isoladas são criadas para o motor de automação,
-- sem dependência de auth.uid().
--
-- Padrão confirmado em: 20260707100000_fix_move_opportunity_service_role_bypass.sql
--
-- SEGURANÇA
-- ---------
-- Todas as funções são SECURITY DEFINER com SET search_path = public.
-- Apenas automation_manage_opportunity_items_v1 tem GRANT EXECUTE TO service_role.
-- As funções internas (helpers) NÃO precisam de GRANT TO service_role porque:
--   - Quando a orquestradora (SECURITY DEFINER) é chamada por service_role,
--     ela executa com a identidade do owner (postgres).
--   - Quando a orquestradora chama os helpers, a identidade ativa é postgres.
--   - postgres é owner de todos os objetos e tem EXECUTE implícito.
--   - Portanto, service_role nunca precisa de privilégio direto nos helpers.
-- Quem pode chamar os helpers: somente a orquestradora (via postgres).
-- Quem pode chamar a orquestradora: somente service_role.
-- Como company_id é validado: WHERE id = X AND company_id = p_company_id em
--   todas as queries; NOT FOUND → EXCEPTION.
-- Cross-tenant: oportunidade, produto e serviço validados pelo par (id, company_id).
-- Por que SECURITY DEFINER: necessário para contornar RLS em contexto service_role
--   e para garantir que os helpers executem como postgres.
--
-- FONTE DE VERDADE PARA REGRAS DE NEGÓCIO
-- ----------------------------------------
-- automation_add_opportunity_item_internal_v1:
--   replica EXATAMENTE as regras de opportunity_add_item
--   (20260521600000_fix_opportunity_add_item_entitlement_check.sql)
--   Diferenças intencionais documentadas na função.
-- automation_sync_opportunity_totals_internal_v1:
--   replica EXATAMENTE as regras de opportunity_sync_totals
--   (20260415140100_opportunity_items_rpcs.sql)
--   Diferenças intencionais documentadas na função.
--
-- ATENÇÃO: qualquer alteração nas regras de negócio de oportunidades/itens
-- (descontos, cálculos, catálogo, disponibilidade, sincronização de totais)
-- deve ser replicada nestas funções para manter equivalência com as RPCs originais.
--
-- ROLLBACK (ordem correta: orquestradora → helpers)
-- ---------
-- DROP FUNCTION IF EXISTS public.automation_manage_opportunity_items_v1(UUID, UUID, TEXT, JSONB);
-- DROP FUNCTION IF EXISTS public.automation_sync_opportunity_totals_internal_v1(UUID, UUID);
-- DROP FUNCTION IF EXISTS public.automation_add_opportunity_item_internal_v1(
--   UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC
-- );
-- =============================================================================


-- =============================================================================
-- HELPER 1: automation_add_opportunity_item_internal_v1
-- Responsabilidade: adicionar um único item a uma oportunidade.
-- Regras: idênticas a opportunity_add_item (20260521600000), sem:
--   - company_user_has_access (não aplicável a service_role / auth.uid() = NULL)
--   - opp_require_company_currency (empresa validada implicitamente pela oportunidade)
--   - opportunity_sync_totals após insert (sync feito pelo orquestrador ao final)
-- Diferença intencional:
--   - description_snapshot: NULL (sem parâmetro p_description_snapshot na automação)
--   - name_snapshot: sempre v_name do catálogo (sem parâmetro p_name_snapshot override)
-- GRANT: somente ao owner (postgres) — não exposto a service_role diretamente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.automation_add_opportunity_item_internal_v1(
  p_company_id      UUID,
  p_opportunity_id  UUID,
  p_product_id      UUID    DEFAULT NULL,
  p_service_id      UUID    DEFAULT NULL,
  p_quantity        NUMERIC DEFAULT NULL,
  p_unit_price      NUMERIC DEFAULT NULL,
  p_discount_type   TEXT    DEFAULT 'fixed',
  p_discount_value  NUMERIC DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Quem pode executar: somente a orquestradora (via identidade postgres).
-- service_role não tem GRANT EXECUTE nesta função.
-- Quando a orquestradora (SECURITY DEFINER) chama esta função, a identidade
-- ativa é postgres (owner), que tem privilégio implícito.
-- Fonte de verdade: opportunity_add_item (20260521600000).
DECLARE
  v_id          UUID;
  v_opp_status  TEXT;
  v_line_total  NUMERIC;
  v_name        TEXT;
  v_unit        NUMERIC;
  v_line_type   TEXT;
  v_cat_active  BOOLEAN;
  v_avail       TEXT;
BEGIN
  -- 1. Validar entitlement (sem auth.uid() — company_has_opportunity_items_entitlement é segura)
  --    Equivalente ao check em opportunity_add_item, mas feito pelo orquestrador
  --    (aqui fica apenas como segunda camada de defesa).
  --    O orquestrador já validou antes de chamar este helper.
  --    Nota: company_user_has_access omitido — auth.uid() = NULL via service_role.

  -- 2. Validar que a oportunidade pertence à empresa e obter status
  SELECT o.status
  INTO v_opp_status
  FROM public.opportunities o
  WHERE o.id = p_opportunity_id
    AND o.company_id = p_company_id;

  IF NOT FOUND THEN
    PERFORM public.opp_raise(
      'OPP_OPPORTUNITY_ACCESS_DENIED',
      'Oportunidade não encontrada ou sem permissão.'
    );
  END IF;

  IF v_opp_status IS DISTINCT FROM 'open' THEN
    PERFORM public.opp_raise(
      'OPP_OPPORTUNITY_NOT_EDITABLE',
      'Esta oportunidade não pode ser editada no estado atual.',
      jsonb_build_object('current_status', v_opp_status)
    );
  END IF;

  -- 3. Validar XOR produto/serviço (exatamente um dos dois)
  IF (p_product_id IS NULL) = (p_service_id IS NULL) THEN
    PERFORM public.opp_raise(
      'OPP_CATALOG_NOT_FOUND',
      'Informe exatamente um entre productId e serviceId.'
    );
  END IF;

  -- 4. Validar quantidade
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    PERFORM public.opp_raise(
      'OPP_INVALID_QUANTITY',
      'A quantidade deve ser maior que zero.'
    );
  END IF;

  -- 5. Validar catálogo (ownership, ativo, disponível) e obter preço/nome padrão
  IF p_product_id IS NOT NULL THEN
    v_line_type := 'product';

    SELECT p.name, p.default_price, p.is_active, p.availability_status
    INTO v_name, v_unit, v_cat_active, v_avail
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.company_id = p_company_id;

    IF NOT FOUND THEN
      PERFORM public.opp_raise(
        'OPP_CATALOG_NOT_FOUND',
        'Produto não encontrado ou não pertence a esta empresa.'
      );
    END IF;

    IF NOT v_cat_active THEN
      PERFORM public.opp_raise(
        'OPP_CATALOG_ITEM_INACTIVE',
        'Este produto está inativo e não pode ser usado.'
      );
    END IF;

    IF v_avail NOT IN ('available', 'on_demand') THEN
      PERFORM public.opp_raise(
        'OPP_CATALOG_NOT_SALEABLE',
        'Este produto não está disponível para venda.'
      );
    END IF;

  ELSE
    v_line_type := 'service';

    SELECT s.name, s.default_price, s.is_active, s.availability_status
    INTO v_name, v_unit, v_cat_active, v_avail
    FROM public.services s
    WHERE s.id = p_service_id
      AND s.company_id = p_company_id;

    IF NOT FOUND THEN
      PERFORM public.opp_raise(
        'OPP_CATALOG_NOT_FOUND',
        'Serviço não encontrado ou não pertence a esta empresa.'
      );
    END IF;

    IF NOT v_cat_active THEN
      PERFORM public.opp_raise(
        'OPP_CATALOG_ITEM_INACTIVE',
        'Este serviço está inativo e não pode ser usado.'
      );
    END IF;

    IF v_avail NOT IN ('available', 'on_demand') THEN
      PERFORM public.opp_raise(
        'OPP_CATALOG_NOT_SALEABLE',
        'Este serviço não está disponível para venda.'
      );
    END IF;
  END IF;

  -- 6. Resolver preço unitário: override se fornecido, senão usa default_price do catálogo
  --    Equivalente à regra em opportunity_add_item.
  IF p_unit_price IS NOT NULL THEN
    v_unit := p_unit_price;
  END IF;

  IF v_unit IS NULL OR v_unit < 0 THEN
    PERFORM public.opp_raise(
      'OPP_INVALID_QUANTITY',
      'Preço unitário inválido (nulo ou negativo).'
    );
  END IF;

  -- 7. Calcular line_total reutilizando o helper matemático existente
  --    opp_compute_line_total usa OUT o_line_total, chamado via SELECT ... FROM.
  v_line_total := (
    SELECT o_line_total
    FROM public.opp_compute_line_total(
      v_unit, p_quantity, p_discount_type, p_discount_value
    )
  );

  -- 8. Inserir item
  --    name_snapshot: sempre v_name do catálogo (sem override na automação)
  --    description_snapshot: NULL explicitamente
  --      Diferença intencional: opportunity_add_item aceita p_description_snapshot
  --      como parâmetro. Na automação, não há override de descrição.
  --    created_at/updated_at: explícitos para evitar dependência de DEFAULT.
  INSERT INTO public.opportunity_items (
    company_id,
    opportunity_id,
    product_id,
    service_id,
    line_type,
    name_snapshot,
    description_snapshot,
    unit_price,
    quantity,
    discount_type,
    discount_value,
    line_total,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_opportunity_id,
    p_product_id,
    p_service_id,
    v_line_type,
    v_name,
    NULL,
    v_unit,
    p_quantity,
    p_discount_type,
    p_discount_value,
    v_line_total,
    now(),
    now()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Helpers internos: SEM GRANT a service_role.
-- Somente o owner (postgres) pode executar — chamados pela orquestradora SECURITY DEFINER.
REVOKE ALL ON FUNCTION public.automation_add_opportunity_item_internal_v1(
  UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_add_opportunity_item_internal_v1(
  UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC
) FROM anon;
REVOKE ALL ON FUNCTION public.automation_add_opportunity_item_internal_v1(
  UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC
) FROM authenticated;
REVOKE ALL ON FUNCTION public.automation_add_opportunity_item_internal_v1(
  UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC
) FROM service_role;


-- =============================================================================
-- HELPER 2: automation_sync_opportunity_totals_internal_v1
-- Responsabilidade: sincronizar totais da oportunidade após operação de itens.
-- Regras: idênticas a opportunity_sync_totals (20260415140100).
-- Diferenças intencionais:
--   - company_user_has_access omitido (auth.uid() = NULL via service_role)
--   - company_has_opportunity_items_entitlement omitido (verificado pelo orquestrador)
--   - SELECT de discount_type/discount_value: feito em único SELECT inicial
--     (simplificação segura — o loop não modifica opportunities)
-- GRANT: somente ao owner (postgres) — não exposto a service_role diretamente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.automation_sync_opportunity_totals_internal_v1(
  p_company_id      UUID,
  p_opportunity_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Fonte de verdade: opportunity_sync_totals (20260415140100_opportunity_items_rpcs.sql)
-- Sem company_user_has_access — service_role é confiável via orquestradora.
-- Recalcula line_total de todos os itens (equivalência com opportunity_sync_totals).
DECLARE
  v_mode       TEXT;
  v_dt         TEXT;
  v_dv         NUMERIC;
  r            RECORD;
  v_lt         NUMERIC;
  v_items_sum  NUMERIC;
  v_val        NUMERIC;
BEGIN
  -- 1. Buscar modo e desconto global da oportunidade
  SELECT o.value_mode, o.discount_type, o.discount_value
  INTO v_mode, v_dt, v_dv
  FROM public.opportunities o
  WHERE o.id = p_opportunity_id
    AND o.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_sync_opportunity_totals_internal_v1: oportunidade % não encontrada na empresa %',
      p_opportunity_id, p_company_id;
  END IF;

  -- 2. Sync somente se value_mode = 'items' (idêntico a opportunity_sync_totals)
  IF v_mode <> 'items' THEN
    RETURN;
  END IF;

  -- 3. Recalcular line_total de cada item
  --    Equivalente ao FOR LOOP de opportunity_sync_totals.
  FOR r IN
    SELECT id, unit_price, quantity, discount_type, discount_value
    FROM public.opportunity_items
    WHERE opportunity_id = p_opportunity_id
      AND company_id     = p_company_id
  LOOP
    v_lt := (
      SELECT o_line_total
      FROM public.opp_compute_line_total(
        r.unit_price, r.quantity, r.discount_type, r.discount_value
      )
    );
    UPDATE public.opportunity_items
    SET line_total  = v_lt,
        updated_at  = now()
    WHERE id = r.id;
  END LOOP;

  -- 4. Somar subtotal de itens
  SELECT COALESCE(round(sum(line_total), 2), 0)
  INTO v_items_sum
  FROM public.opportunity_items
  WHERE opportunity_id = p_opportunity_id
    AND company_id     = p_company_id;

  -- 5. Resolver desconto global (fallback para fixed/0 se nulo)
  --    Equivalente ao bloco IF v_dt IS NULL em opportunity_sync_totals.
  IF v_dt IS NULL THEN
    v_dt := 'fixed';
    v_dv := 0;
  END IF;

  -- 6. Calcular valor final com desconto global
  --    opp_compute_global_value retorna NUMERIC diretamente.
  v_val := public.opp_compute_global_value(
    v_items_sum,
    v_dt,
    COALESCE(v_dv, 0)
  );

  -- 7. Atualizar oportunidade (idêntico a opportunity_sync_totals)
  UPDATE public.opportunities
  SET items_subtotal  = v_items_sum,
      value           = v_val,
      discount_type   = v_dt,
      discount_value  = COALESCE(v_dv, 0),
      updated_at      = now()
  WHERE id         = p_opportunity_id
    AND company_id = p_company_id;
END;
$$;

-- Helpers internos: SEM GRANT a service_role.
REVOKE ALL ON FUNCTION public.automation_sync_opportunity_totals_internal_v1(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_sync_opportunity_totals_internal_v1(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.automation_sync_opportunity_totals_internal_v1(UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.automation_sync_opportunity_totals_internal_v1(UUID, UUID) FROM service_role;


-- =============================================================================
-- ORQUESTRADOR: automation_manage_opportunity_items_v1
-- Responsabilidade: ponto de entrada único para o motor de automação.
-- Somente esta função tem GRANT EXECUTE TO service_role.
-- As funções internas são chamadas sob identidade postgres (owner).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.automation_manage_opportunity_items_v1(
  p_company_id      UUID,
  p_opportunity_id  UUID,
  p_items_mode      TEXT,    -- 'add' | 'replace'
  p_items           JSONB    -- array de itens; null ou [] = vazio
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
-- Quem pode executar: somente service_role (GRANT abaixo).
-- Funções internas: chamadas via identidade postgres (owner), sem GRANT extra.
-- Atomicidade: PostgreSQL executa toda a função em uma transação implícita;
--   qualquer RAISE EXCEPTION reverte todas as operações do lote.
-- Por que SECURITY DEFINER: necessário para executar como postgres ao invocar helpers.
-- Cross-tenant: (opportunity_id, company_id) e catálogo validados em todo SELECT.
DECLARE
  v_opp_status  TEXT;
  v_items       JSONB;
  v_items_count INTEGER;
  v_item        JSONB;
  v_product_id  UUID;
  v_service_id  UUID;
  v_quantity    NUMERIC;
  v_unit_price  NUMERIC;
  v_disc_type   TEXT;
  v_disc_value  NUMERIC;
  v_i           INTEGER;
  v_processed   INTEGER := 0;
BEGIN
  -- 1. Validar parâmetros obrigatórios
  IF p_company_id IS NULL OR p_opportunity_id IS NULL THEN
    RAISE EXCEPTION 'automation_manage_opportunity_items_v1: p_company_id e p_opportunity_id são obrigatórios';
  END IF;

  IF p_items_mode IS NULL OR p_items_mode NOT IN ('add', 'replace') THEN
    RAISE EXCEPTION 'automation_manage_opportunity_items_v1: p_items_mode deve ser "add" ou "replace", recebido: "%"',
      p_items_mode;
  END IF;

  -- 2. Normalizar p_items: NULL → [] (array vazio válido)
  v_items := COALESCE(p_items, '[]'::jsonb);

  -- 3. Validar que p_items é um array JSON (não objeto, string ou número)
  IF jsonb_typeof(v_items) <> 'array' THEN
    RAISE EXCEPTION 'automation_manage_opportunity_items_v1: p_items deve ser um array JSON (recebido: %)',
      jsonb_typeof(v_items);
  END IF;

  v_items_count := jsonb_array_length(v_items);

  -- 4. Validar oportunidade + company_id
  SELECT o.status
  INTO v_opp_status
  FROM public.opportunities o
  WHERE o.id = p_opportunity_id
    AND o.company_id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'automation_manage_opportunity_items_v1: oportunidade % não encontrada na empresa %',
      p_opportunity_id, p_company_id;
  END IF;

  -- 5. Validar entitlement
  IF NOT public.company_has_opportunity_items_entitlement(p_company_id) THEN
    RAISE EXCEPTION 'automation_manage_opportunity_items_v1: composição por itens não habilitada para a empresa %',
      p_company_id;
  END IF;

  -- 6. Validar status editável
  IF v_opp_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'automation_manage_opportunity_items_v1: oportunidade com status "%" não pode ter itens editados',
      v_opp_status;
  END IF;

  -- 7. Modo replace: remover todos os itens existentes antes de adicionar
  --    DELETE direto com (company_id, opportunity_id) — sem chamar opportunity_remove_item
  --    (que usa company_user_has_access, incompatível com service_role).
  --    Comportamento para replace + []: remove todos os itens e não insere nenhum.
  IF p_items_mode = 'replace' THEN
    DELETE FROM public.opportunity_items
    WHERE opportunity_id = p_opportunity_id
      AND company_id     = p_company_id;
  END IF;

  -- 8. Adicionar novos itens
  --    Proteção explícita para array vazio (add + [] = sem operação, sem erro).
  --    Para replace + [], o DELETE já foi feito no passo 7.
  IF v_items_count > 0 THEN
    FOR v_i IN 0 .. v_items_count - 1 LOOP
      v_item := v_items->v_i;

      -- 8a. Validar que cada elemento é um objeto JSON
      IF jsonb_typeof(v_item) <> 'object' THEN
        RAISE EXCEPTION 'automation_manage_opportunity_items_v1: items[%] deve ser um objeto JSON, recebido: %',
          v_i, jsonb_typeof(v_item);
      END IF;

      -- 8b. Extrair campos do item JSONB com tratamento de null JSON
      v_product_id := CASE
        WHEN v_item ? 'productId'
          AND v_item->>'productId' IS NOT NULL
          AND v_item->>'productId' <> ''
          AND v_item->>'productId' <> 'null'
          THEN (v_item->>'productId')::UUID
        ELSE NULL
      END;

      v_service_id := CASE
        WHEN v_item ? 'serviceId'
          AND v_item->>'serviceId' IS NOT NULL
          AND v_item->>'serviceId' <> ''
          AND v_item->>'serviceId' <> 'null'
          THEN (v_item->>'serviceId')::UUID
        ELSE NULL
      END;

      -- Casts com falha proposital: UUID inválido, NUMERIC inválido → EXCEPTION → rollback
      v_quantity   := (v_item->>'quantity')::NUMERIC;
      v_disc_type  := COALESCE(NULLIF(v_item->>'discountType', ''), 'fixed');
      v_disc_value := COALESCE((v_item->>'discountValue')::NUMERIC, 0);

      -- unit_price: null JSON → NULL NUMERIC (usar default_price do catálogo)
      v_unit_price := CASE
        WHEN v_item ? 'unitPrice'
          AND v_item->>'unitPrice' IS NOT NULL
          AND v_item->>'unitPrice' <> 'null'
          THEN (v_item->>'unitPrice')::NUMERIC
        ELSE NULL
      END;

      -- 8c. Chamar helper interno (valida catálogo, preço, desconto, insere item)
      --     PERFORM descarta o UUID retornado (não necessário no orquestrador).
      --     Qualquer EXCEPTION propaga e reverte toda a operação (transação implícita).
      PERFORM public.automation_add_opportunity_item_internal_v1(
        p_company_id,
        p_opportunity_id,
        v_product_id,
        v_service_id,
        v_quantity,
        v_unit_price,
        v_disc_type,
        v_disc_value
      );

      v_processed := v_processed + 1;
    END LOOP;
  END IF;

  -- 9. Sincronizar totais ao final (uma única chamada para eficiência)
  --    Se value_mode != 'items', o helper retorna sem fazer nada.
  --    Para replace + [], sincroniza com zero itens → value = 0 (correto).
  PERFORM public.automation_sync_opportunity_totals_internal_v1(
    p_company_id,
    p_opportunity_id
  );

  -- 10. Retornar resultado estruturado
  RETURN jsonb_build_object(
    'success',         TRUE,
    'opportunity_id',  p_opportunity_id,
    'items_mode',      p_items_mode,
    'items_processed', v_processed
  );

END;
$$;

-- Somente a orquestradora tem GRANT a service_role.
REVOKE ALL ON FUNCTION public.automation_manage_opportunity_items_v1(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.automation_manage_opportunity_items_v1(UUID, UUID, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.automation_manage_opportunity_items_v1(UUID, UUID, TEXT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.automation_manage_opportunity_items_v1(UUID, UUID, TEXT, JSONB) TO service_role;


-- =============================================================================
-- ROLLBACK
-- Ordem obrigatória: orquestradora PRIMEIRO, depois os helpers.
-- (orquestradora chama os helpers — deve ser removida antes)
-- Não usar CASCADE. Não altera dados, itens, RPCs existentes ou RLS.
--
-- DROP FUNCTION IF EXISTS public.automation_manage_opportunity_items_v1(
--   UUID, UUID, TEXT, JSONB
-- );
-- DROP FUNCTION IF EXISTS public.automation_sync_opportunity_totals_internal_v1(
--   UUID, UUID
-- );
-- DROP FUNCTION IF EXISTS public.automation_add_opportunity_item_internal_v1(
--   UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC
-- );
-- =============================================================================
