-- Migration: Criar função SECURITY DEFINER para criação de leads via webhook WhatsApp
-- Data: 2026-02-20
-- Objetivo: Permitir criação de leads mantendo RLS ativo em todas as tabelas
-- Uso: Webhook WhatsApp cria leads automaticamente para novos contatos

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
  v_existing_lead_id bigint;
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
    'novo',  -- Status em português conforme constraint leads_status_check
    NOW(),
    NOW()
  ) RETURNING id INTO v_lead_id;
  
  RAISE LOG 'create_lead_from_whatsapp_safe: Lead criado com ID %', v_lead_id;
  
  -- =====================================================
  -- 3. RETORNAR RESULTADO
  -- =====================================================
  
  v_result := jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id,
    'created', true,
    'message', 'Lead criado com sucesso via WhatsApp'
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

-- Comentário explicativo
COMMENT ON FUNCTION public.create_lead_from_whatsapp_safe IS 
'Função SECURITY DEFINER para criação segura de leads via webhook WhatsApp. 
Criada em 2026-02-20 para permitir criação de leads mantendo RLS ativo.
Verifica duplicatas e cria leads com origin=whatsapp e status=new.';

-- Grant de execução para anon (webhook usa chave anon)
GRANT EXECUTE ON FUNCTION public.create_lead_from_whatsapp_safe TO anon;
GRANT EXECUTE ON FUNCTION public.create_lead_from_whatsapp_safe TO authenticated;
