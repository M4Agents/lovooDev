-- =====================================================
-- MIGRATION: GET CONVERSATION LEAD ID
-- Data: 25/03/2026
-- Objetivo: Permitir webhook buscar lead_id da conversa via RPC
-- =====================================================

-- =====================================================
-- FUNÇÃO: BUSCAR LEAD_ID DA CONVERSA
-- =====================================================
-- Retorna lead_id de uma conversa específica
-- Usa SECURITY DEFINER para bypass do RLS
-- Chamada pelo webhook quando lead responde mensagem
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_conversation_lead_id(
  p_conversation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lead_id integer;
BEGIN
  -- Buscar lead_id da conversa
  SELECT lead_id INTO v_lead_id
  FROM chat_conversations
  WHERE id = p_conversation_id;
  
  IF v_lead_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Conversa não encontrada ou sem lead vinculado'
    );
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id
  );
  
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- =====================================================
-- GRANTS (Segurança)
-- =====================================================

-- Permitir execução via anon (webhook usa client anon)
GRANT EXECUTE ON FUNCTION public.get_conversation_lead_id(uuid) TO anon;

-- Permitir execução via service role (API)
GRANT EXECUTE ON FUNCTION public.get_conversation_lead_id(uuid) TO service_role;

-- =====================================================
-- COMENTÁRIOS E DOCUMENTAÇÃO
-- =====================================================

COMMENT ON FUNCTION public.get_conversation_lead_id(uuid) IS 
'Retorna lead_id de uma conversa específica. Usa SECURITY DEFINER para bypass do RLS. Chamada pelo webhook quando lead responde mensagem user_input.';
