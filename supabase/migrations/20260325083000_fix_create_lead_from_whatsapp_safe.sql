-- =====================================================
-- MIGRATION: Corrigir função create_lead_from_whatsapp_safe
-- Data: 25/03/2026
-- Descrição: Atualizar função para criar lead + opportunity e usar tabela correta
-- Problema: Tabela lead_funnel_positions foi renomeada para opportunity_funnel_positions
-- Solução: Criar lead, opportunity e adicionar ao funil usando tabela correta
-- =====================================================

CREATE OR REPLACE FUNCTION public.create_lead_from_whatsapp_safe(
  p_company_id uuid,
  p_phone text,
  p_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_id bigint;
  v_opportunity_id uuid;
  v_existing_lead_id bigint;
  v_funnel_id uuid;
  v_stage_id uuid;
  v_result jsonb;
BEGIN
  -- Log de entrada
  RAISE LOG 'create_lead_from_whatsapp_safe: Iniciando para empresa % telefone %', p_company_id, p_phone;
  
  -- =====================================================
  -- 1. VERIFICAR SE JÁ EXISTE LEAD PARA ESTE TELEFONE
  -- =====================================================
  
  SELECT id INTO v_existing_lead_id
  FROM leads
  WHERE phone = p_phone
    AND company_id = p_company_id
    AND deleted_at IS NULL;
  
  IF v_existing_lead_id IS NOT NULL THEN
    RAISE LOG 'create_lead_from_whatsapp_safe: Lead já existe com ID %', v_existing_lead_id;
    
    v_result := jsonb_build_object(
      'success', true,
      'lead_id', v_existing_lead_id,
      'created', false,
      'message', 'Lead já existe para este telefone'
    );
    
    RETURN v_result;
  END IF;
  
  -- =====================================================
  -- 2. CRIAR NOVO LEAD
  -- =====================================================
  
  INSERT INTO leads (
    company_id,
    phone,
    name,
    origin,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_company_id,
    p_phone,
    p_name,
    'whatsapp',
    'novo',
    NOW(),
    NOW()
  ) RETURNING id INTO v_lead_id;
  
  RAISE LOG 'create_lead_from_whatsapp_safe: Lead criado com ID %', v_lead_id;
  
  -- =====================================================
  -- 3. CRIAR OPPORTUNITY VINCULADA AO LEAD
  -- =====================================================
  
  INSERT INTO opportunities (
    lead_id,
    company_id,
    title,
    status,
    source,
    created_at,
    updated_at
  ) VALUES (
    v_lead_id,
    p_company_id,
    'Oportunidade - ' || p_name,
    'open',
    'whatsapp',
    NOW(),
    NOW()
  ) RETURNING id INTO v_opportunity_id;
  
  RAISE LOG 'create_lead_from_whatsapp_safe: Opportunity criada com ID %', v_opportunity_id;
  
  -- =====================================================
  -- 4. BUSCAR FUNIL PADRÃO DA EMPRESA
  -- =====================================================
  
  SELECT id INTO v_funnel_id
  FROM sales_funnels
  WHERE company_id = p_company_id
    AND is_default = true
    AND is_active = true
  LIMIT 1;
  
  -- =====================================================
  -- 5. SE TEM FUNIL, ADICIONAR À ETAPA INICIAL
  -- =====================================================
  
  IF v_funnel_id IS NOT NULL THEN
    RAISE LOG 'create_lead_from_whatsapp_safe: Funil padrão encontrado: %', v_funnel_id;
    
    -- Buscar etapa "Lead Novo" (system stage, position 0)
    SELECT id INTO v_stage_id
    FROM funnel_stages
    WHERE funnel_id = v_funnel_id
      AND is_system_stage = true
      AND position = 0
    LIMIT 1;
    
    IF v_stage_id IS NOT NULL THEN
      RAISE LOG 'create_lead_from_whatsapp_safe: Etapa inicial encontrada: %', v_stage_id;
      
      -- CORREÇÃO: Usar opportunity_funnel_positions ao invés de lead_funnel_positions
      INSERT INTO opportunity_funnel_positions (
        lead_id,
        opportunity_id,
        funnel_id,
        stage_id,
        position_in_stage,
        entered_stage_at,
        created_at,
        updated_at
      ) VALUES (
        v_lead_id,
        v_opportunity_id,
        v_funnel_id,
        v_stage_id,
        0,
        NOW(),
        NOW(),
        NOW()
      );
      
      RAISE LOG 'create_lead_from_whatsapp_safe: Lead adicionado ao funil';
    ELSE
      RAISE LOG 'create_lead_from_whatsapp_safe: Etapa inicial não encontrada';
    END IF;
  ELSE
    RAISE LOG 'create_lead_from_whatsapp_safe: Funil padrão não encontrado';
  END IF;
  
  -- =====================================================
  -- 6. RETORNAR RESULTADO
  -- =====================================================
  
  v_result := jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id,
    'opportunity_id', v_opportunity_id,
    'created', true,
    'message', 'Lead e oportunidade criados com sucesso via WhatsApp'
  );
  
  RETURN v_result;
  
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'create_lead_from_whatsapp_safe: ERRO - %', SQLERRM;
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'message', 'Erro ao criar lead via WhatsApp'
    );
END;
$function$;

-- =====================================================
-- COMENTÁRIOS
-- =====================================================

COMMENT ON FUNCTION public.create_lead_from_whatsapp_safe IS 
'Função SECURITY DEFINER para criação segura de leads via webhook WhatsApp. 
ATUALIZADA em 2026-03-25 para:
- Criar lead na tabela leads
- Criar opportunity vinculada ao lead
- Adicionar ao funil usando opportunity_funnel_positions (tabela correta)
- Retornar lead_id e opportunity_id';

-- Grants já existem da versão anterior, mas garantir
GRANT EXECUTE ON FUNCTION public.create_lead_from_whatsapp_safe TO anon;
GRANT EXECUTE ON FUNCTION public.create_lead_from_whatsapp_safe TO authenticated;
