-- =============================================================================
-- FASE 5ZE — Adiciona coluna available_to_all em whatsapp_life_instances
--
-- OBJETIVO:
--   Permitir que uma instância seja marcada como compartilhada, aparecendo
--   no seletor de TODOS os sellers sem alterar a regra de visibilidade de
--   conversas (que continua definida exclusivamente por assigned_to).
--
-- IMPACTO IMEDIATO:
--   Nenhum. DEFAULT false preserva integralmente o comportamento atual.
--   Nenhuma instância existente é marcada como available_to_all = true.
--   Nenhum dado é alterado.
--
-- REGRA DE NEGÓCIO:
--   available_to_all = true → instância aparece no seletor de todos os sellers
--   available_to_all = false (padrão) → comportamento FASE 5ZD preservado
--   A visibilidade da conversa continua sendo: chat_conversations.assigned_to
--
-- ROLLBACK LÓGICO (preferencial):
--   UPDATE public.whatsapp_life_instances
--   SET available_to_all = false
--   WHERE company_id = '<company_id>';
--
-- ROLLBACK ESTRUTURAL (apenas se necessário):
--   ALTER TABLE public.whatsapp_life_instances DROP COLUMN IF EXISTS available_to_all;
-- =============================================================================

ALTER TABLE public.whatsapp_life_instances
  ADD COLUMN IF NOT EXISTS available_to_all BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.whatsapp_life_instances.available_to_all IS
  'Quando true, a instância aparece no seletor de todos os sellers e pode ser usada '
  'por sellers restritos sem conceder acesso a conversas de outros usuários. '
  'A visibilidade da conversa continua definida exclusivamente por chat_conversations.assigned_to.';
