-- =====================================================================
-- Migration: Claim e retry do agente em instagram_messages
-- Data: 2026-08-02
--
-- Objetivo:
--   Implementar máquina de estados para idempotência de execução do
--   agente de IA por mensagem. Reutiliza a tabela existente, sem
--   criar nova tabela nem novo RLS.
--
-- Campos adicionados:
--   agent_exec_status — estado da execução do agente (nullable)
--   agent_queued_at   — timestamp do claim ativo (nullable)
--
-- Máquina de estados:
--   NULL       → nunca processada pelo agente (estado inicial)
--   processing → claim ativo, agente em execução
--   completed  → agente respondeu com sucesso — bloqueio definitivo
--   failed     → agente falhou — elegível para retry
--
-- Claim atômico (documentação para o instagramAgentExecutor):
--   Usar UPDATE único — sem SELECT prévio para evitar race condition.
--
--   UPDATE public.instagram_messages
--   SET
--     agent_exec_status = 'processing',
--     agent_queued_at   = now()
--   WHERE ig_message_id = $1    -- identificador global único (UNIQUE constraint)
--     AND company_id    = $2    -- defesa multi-tenant obrigatória
--     AND (
--       agent_exec_status IS NULL          -- nunca processada
--       OR agent_exec_status = 'failed'    -- retry após falha
--       OR (
--         agent_exec_status = 'processing'
--         AND agent_queued_at < now() - interval '5 minutes'  -- claim expirado
--       )
--     )
--   RETURNING id;
--
--   Resultado:
--     1 row  → claim adquirido → prosseguir com execução
--     0 rows → mensagem em completed (ou processing ativo) → abortar silenciosamente
--
-- Completar execução (após resposta enviada com sucesso):
--   UPDATE public.instagram_messages
--   SET agent_exec_status = 'completed'
--   WHERE ig_message_id = $1 AND company_id = $2;
--
-- Marcar falha (após erro irrecuperável):
--   UPDATE public.instagram_messages
--   SET agent_exec_status = 'failed'
--   WHERE ig_message_id = $1 AND company_id = $2;
--
-- Nota sobre ig_message_id:
--   A constraint uq_instagram_messages_ig_id é GLOBALMENTE única (sem company_id).
--   O filtro por company_id é defesa multi-tenant — correto e obrigatório.
--
-- Segurança:
--   Operado exclusivamente pelo backend via service_role.
--   Policies RLS existentes continuam válidas — sem policy nova necessária.
--   Dados existentes: agent_exec_status e agent_queued_at iniciam como NULL.
-- =====================================================================

ALTER TABLE public.instagram_messages
  ADD COLUMN IF NOT EXISTS agent_exec_status TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS agent_queued_at   TIMESTAMPTZ DEFAULT NULL;

-- Constraint nomeada explicitamente: facilita DROP/ALTER em migrations futuras
ALTER TABLE public.instagram_messages
  ADD CONSTRAINT chk_igmsg_agent_exec_status
    CHECK (agent_exec_status IN ('processing', 'completed', 'failed'));

-- Índice parcial: otimiza stuck recovery e monitoramento de claims travados.
-- Query de stuck recovery:
--   WHERE agent_exec_status = 'processing'
--     AND agent_queued_at < now() - interval '5 minutes'
-- O índice cobre apenas linhas em 'processing' (minoria), minimizando tamanho.
-- Linhas em completed, failed e NULL são excluídas do índice.
CREATE INDEX IF NOT EXISTS idx_igmsg_agent_processing
  ON public.instagram_messages (agent_queued_at)
  WHERE agent_exec_status = 'processing';

COMMENT ON COLUMN public.instagram_messages.agent_exec_status IS
  'Estado da execução do agente de IA para esta mensagem.
   NULL:       nunca processada pelo agente (estado inicial).
   processing: claim ativo — agente em execução. Expiração: 5 minutos.
   completed:  resposta enviada com sucesso — bloqueio definitivo contra double-send.
   failed:     falha — elegível para retry via claim atômico.
   Operado exclusivamente pelo instagramAgentExecutor via service_role.
   Constraint: chk_igmsg_agent_exec_status.';

COMMENT ON COLUMN public.instagram_messages.agent_queued_at IS
  'Timestamp do claim ativo (agent_exec_status = processing).
   Usado para stuck recovery: claims com agent_exec_status = processing
   e agent_queued_at < now() - 5min são considerados expirados e reivindicáveis
   pelo próximo worker via UPDATE atômico.
   NULL quando agent_exec_status é NULL, completed ou failed.';
