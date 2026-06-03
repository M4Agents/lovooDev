-- Migration: fix_change_conversation_instance_conflict_check
-- Objetivo: detectar conflito de unicidade ANTES do UPDATE e retornar JSON amigável
-- em vez de deixar a constraint UNIQUE(company_id, instance_id, contact_phone) explodir
-- com HTTP 409 bruto.
--
-- Rollback:
--   Restaurar a versão anterior da função (sem o bloco de verificação de conflito).
--   Ver seção de rollback ao final deste arquivo.

CREATE OR REPLACE FUNCTION public.change_conversation_instance(
  p_conversation_id uuid,
  p_new_instance_id uuid,
  p_company_id      uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instance_name   TEXT;
  v_old_instance_id uuid;
  v_contact_phone   TEXT;
  v_conflict_id     uuid;
BEGIN
  -- 1. Buscar instância antiga e telefone da conversa atual
  SELECT instance_id, contact_phone
    INTO v_old_instance_id, v_contact_phone
    FROM public.chat_conversations
   WHERE id         = p_conversation_id
     AND company_id = p_company_id;

  IF v_old_instance_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Conversa não encontrada'
    );
  END IF;

  -- 2. Validar que a nova instância existe, pertence à empresa e está conectada
  SELECT instance_name INTO v_instance_name
    FROM public.whatsapp_life_instances
   WHERE id         = p_new_instance_id
     AND company_id = p_company_id
     AND status     = 'connected';

  IF v_instance_name IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Instância não encontrada ou não conectada'
    );
  END IF;

  -- 3. Verificar conflito com a constraint UNIQUE(company_id, instance_id, contact_phone).
  --    A constraint não filtra por status, portanto rows arquivadas também bloqueiam a troca.
  SELECT id INTO v_conflict_id
    FROM public.chat_conversations
   WHERE company_id    = p_company_id
     AND instance_id   = p_new_instance_id
     AND contact_phone = v_contact_phone
     AND id            <> p_conversation_id
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success',                 false,
      'error',                   'Já existe uma conversa com este contato nesta instância. Use a conversa existente ou consolide/remova o registro conflitante antes de trocar a instância.',
      'conflict_conversation_id', v_conflict_id
    );
  END IF;

  -- 4. Atualizar instância da conversa
  UPDATE public.chat_conversations
     SET instance_id = p_new_instance_id,
         updated_at  = NOW()
   WHERE id         = p_conversation_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Erro ao atualizar conversa'
    );
  END IF;

  RETURN jsonb_build_object(
    'success',           true,
    'message',           'Instância alterada com sucesso',
    'new_instance_name', v_instance_name,
    'old_instance_id',   v_old_instance_id,
    'new_instance_id',   p_new_instance_id
  );
END;
$$;

-- ============================================================
-- ROLLBACK (executar apenas se necessário reverter)
-- ============================================================
-- CREATE OR REPLACE FUNCTION public.change_conversation_instance(
--   p_conversation_id uuid,
--   p_new_instance_id uuid,
--   p_company_id      uuid
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--   v_instance_name   TEXT;
--   v_old_instance_id uuid;
-- BEGIN
--   SELECT instance_id INTO v_old_instance_id
--     FROM public.chat_conversations
--    WHERE id = p_conversation_id AND company_id = p_company_id;
--
--   IF v_old_instance_id IS NULL THEN
--     RETURN jsonb_build_object('success', false, 'error', 'Conversa não encontrada');
--   END IF;
--
--   SELECT instance_name INTO v_instance_name
--     FROM public.whatsapp_life_instances
--    WHERE id = p_new_instance_id AND company_id = p_company_id AND status = 'connected';
--
--   IF v_instance_name IS NULL THEN
--     RETURN jsonb_build_object('success', false, 'error', 'Instância não encontrada ou não conectada');
--   END IF;
--
--   UPDATE public.chat_conversations
--      SET instance_id = p_new_instance_id, updated_at = NOW()
--    WHERE id = p_conversation_id AND company_id = p_company_id;
--
--   IF NOT FOUND THEN
--     RETURN jsonb_build_object('success', false, 'error', 'Erro ao atualizar conversa');
--   END IF;
--
--   RETURN jsonb_build_object(
--     'success', true,
--     'message', 'Instância alterada com sucesso',
--     'new_instance_name', v_instance_name,
--     'old_instance_id', v_old_instance_id,
--     'new_instance_id', p_new_instance_id
--   );
-- END;
-- $$;
