-- Migration: update_change_conversation_instance_resolve_conflict
-- Objetivo: adicionar parâmetro p_resolve_conflict (boolean DEFAULT false) à função
-- change_conversation_instance para permitir resolução explícita de conflito de
-- unicidade UNIQUE(company_id, instance_id, contact_phone) com confirmação do usuário.
--
-- Comportamento:
--   p_resolve_conflict = false (padrão): detecta conflito e retorna JSON sem alterar dados
--   p_resolve_conflict = true:  arquiva conversa conflitante e executa a troca de instância
--
-- Rollback: ver seção ao final deste arquivo (restaura versão anterior com erro amigável).

CREATE OR REPLACE FUNCTION public.change_conversation_instance(
  p_conversation_id  uuid,
  p_new_instance_id  uuid,
  p_company_id       uuid,
  p_resolve_conflict boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_instance_name   TEXT;
  v_old_instance_id uuid;
  v_contact_phone   TEXT;
  v_current_status  TEXT;
  v_conflict_id     uuid;
BEGIN
  -- 1. Buscar dados da conversa atual (instance_id, contact_phone, status)
  SELECT instance_id, contact_phone, status
    INTO v_old_instance_id, v_contact_phone, v_current_status
    FROM public.chat_conversations
   WHERE id         = p_conversation_id
     AND company_id = p_company_id;

  IF NOT FOUND THEN
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

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Instância não encontrada ou não conectada'
    );
  END IF;

  -- 3. Verificar conflito com a constraint UNIQUE(company_id, instance_id, contact_phone).
  --    Inclui rows arquivadas pois a constraint não filtra por status.
  SELECT id INTO v_conflict_id
    FROM public.chat_conversations
   WHERE company_id    = p_company_id
     AND instance_id   = p_new_instance_id
     AND contact_phone = v_contact_phone
     AND id            <> p_conversation_id
   LIMIT 1;

  -- 4. Conflito detectado + p_resolve_conflict = false → retornar sem alterar dados
  IF v_conflict_id IS NOT NULL AND NOT p_resolve_conflict THEN
    RETURN jsonb_build_object(
      'success',                 false,
      'error',                   'Já existe uma conversa com este contato nesta instância. Use a conversa existente ou confirme o arquivamento da conversa conflitante.',
      'conflict_conversation_id', v_conflict_id
    );
  END IF;

  -- 5. Conflito detectado + p_resolve_conflict = true → arquivar conversa conflitante
  --    instance_id = NULL libera o slot da constraint UNIQUE (NULL não participa da verificação).
  IF v_conflict_id IS NOT NULL AND p_resolve_conflict THEN
    UPDATE public.chat_conversations
       SET status      = 'archived',
           instance_id = NULL,
           updated_at  = NOW()
     WHERE id          = v_conflict_id
       AND company_id  = p_company_id;
  END IF;

  -- 6. Atualizar instância da conversa atual
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
    'success',                  true,
    'message',                  'Instância alterada com sucesso',
    'new_instance_name',        v_instance_name,
    'old_instance_id',          v_old_instance_id,
    'new_instance_id',          p_new_instance_id,
    'archived_conversation_id', v_conflict_id   -- NULL se não havia conflito
  );
END;
$$;

-- ============================================================
-- ROLLBACK (executar apenas se necessário reverter)
-- Restaura a versão com detecção de conflito porém sem resolução automática
-- (versão da migration 20260603140000).
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
--   v_contact_phone   TEXT;
--   v_conflict_id     uuid;
-- BEGIN
--   SELECT instance_id, contact_phone
--     INTO v_old_instance_id, v_contact_phone
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
--   SELECT id INTO v_conflict_id
--     FROM public.chat_conversations
--    WHERE company_id = p_company_id AND instance_id = p_new_instance_id
--      AND contact_phone = v_contact_phone AND id <> p_conversation_id
--    LIMIT 1;
--
--   IF v_conflict_id IS NOT NULL THEN
--     RETURN jsonb_build_object(
--       'success', false,
--       'error', 'Já existe uma conversa com este contato nesta instância. Use a conversa existente ou consolide/remova o registro conflitante antes de trocar a instância.',
--       'conflict_conversation_id', v_conflict_id
--     );
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
--     'success', true, 'message', 'Instância alterada com sucesso',
--     'new_instance_name', v_instance_name,
--     'old_instance_id', v_old_instance_id,
--     'new_instance_id', p_new_instance_id
--   );
-- END;
-- $$;
