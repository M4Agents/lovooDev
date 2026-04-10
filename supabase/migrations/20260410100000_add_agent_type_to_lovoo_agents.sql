-- =====================================================
-- MIGRATION: Adicionar agent_type em lovoo_agents
-- Data: 2026-04-10
--
-- Propósito:
--   Introduzir distinção explícita entre agentes funcionais
--   (utilitários/SaaS, empresa-pai) e agentes conversacionais
--   (chat, habilitados para empresas filhas).
--
-- agent_type:
--   'functional'     → agentes utilitários (field_writer, etc.)
--   'conversational' → agentes de chat WhatsApp/canal
--
-- BACKFILL:
--   Não realizado automaticamente nesta migration.
--   Execute manualmente após validação em DEV:
--
--   -- Marcar como conversacional o agente de teste MVP:
--   UPDATE public.lovoo_agents
--   SET agent_type = 'conversational'
--   WHERE id = '949ff943-54c2-4975-827e-8287f4ea340c';
--
--   -- Verificar resultado antes de produção:
--   SELECT id, name, agent_type FROM public.lovoo_agents ORDER BY name;
-- =====================================================

ALTER TABLE public.lovoo_agents
  ADD COLUMN IF NOT EXISTS agent_type TEXT NOT NULL DEFAULT 'functional'
    CHECK (agent_type IN ('functional', 'conversational'));

COMMENT ON COLUMN public.lovoo_agents.agent_type IS
  'functional: agente utilitário/SaaS criado pela empresa-pai (ex: field_writer). '
  'conversational: agente de chat habilitado para empresas filhas. '
  'Backfill realizado manualmente após validação — ver comentário nesta migration.';
