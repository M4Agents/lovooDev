-- =====================================================
-- MIGRATION: Criar tabela agent_processing_locks
-- Data: 2026-04-09
-- Etapa: 6/13
--
-- Propósito:
--   Mecanismo de trava por conversa para garantir que apenas uma execução
--   do agente de IA processe uma conversa por vez.
--   Previne respostas duplas quando mensagens chegam em rafaga.
--
-- Funcionamento:
--   1. Antes de processar, o Orchestrator tenta INSERT na tabela com
--      ON CONFLICT DO NOTHING (tentativa atômica via constraint UNIQUE)
--   2. Se INSERT retornar 0 linhas: outra execução já tem o lock → descartar
--   3. Se INSERT retornar 1 linha: lock adquirido → processar
--   4. Após processar (sucesso ou erro): DELETE da linha de lock
--   5. Locks com acquired_at > TTL (ex: 5 min) são considerados stale → ignorar
--
-- Acesso:
--   Exclusivamente via service_role (backend).
--   RLS habilitado sem policies → nenhum acesso autenticado via frontend.
--
-- Limpeza:
--   Um job periódico (ou cron via pg_cron) pode limpar locks stale:
--   DELETE FROM agent_processing_locks WHERE acquired_at < now() - interval '5 minutes';
--
-- Dependências: Nenhuma.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.agent_processing_locks (
  -- Chave de lock: uma por conversa ativa
  -- UNIQUE garante que o INSERT ON CONFLICT DO NOTHING seja atômico
  conversation_id   UUID          PRIMARY KEY
    REFERENCES public.chat_conversations(id) ON DELETE CASCADE,

  -- Identificação da execução que detém o lock
  -- Permite diagnóstico de locks stale
  locked_by_run_id  UUID          NULL,

  -- Timestamp de aquisição do lock — usado para detectar stale locks
  acquired_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Índice para limpeza de locks stale via TTL
CREATE INDEX IF NOT EXISTS idx_processing_locks_acquired_at
  ON public.agent_processing_locks (acquired_at);

-- ── RLS: BLOQUEIO TOTAL para acesso autenticado ───────────────────────────────
--
-- Esta tabela é acessada SOMENTE pelo backend via service_role.
-- service_role bypassa RLS por definição.
-- RLS habilitado sem policies = nenhum acesso via anon ou authenticated.
-- Prevenção de acesso indevido pelo frontend ou scripts externos.

ALTER TABLE public.agent_processing_locks ENABLE ROW LEVEL SECURITY;

-- Nenhuma policy criada intencionalmente:
-- authenticated e anon NÃO têm acesso a esta tabela.
-- service_role tem acesso total (bypassa RLS).

COMMENT ON TABLE public.agent_processing_locks IS
  'Travas de processamento por conversa para o agente de IA. '
  'Garante que apenas uma execução processe uma conversa por vez. '
  'INSERT ON CONFLICT DO NOTHING é a operação principal (lock atômico). '
  'Locks stale (acquired_at muito antigo) devem ser limpos periodicamente. '
  'Acesso exclusivo via service_role — RLS sem policies bloqueia frontend.';

COMMENT ON COLUMN public.agent_processing_locks.conversation_id IS
  'PK e FK: uma trava por conversa. '
  'UNIQUE garante que o INSERT atômico seja a única forma de adquirir o lock.';

COMMENT ON COLUMN public.agent_processing_locks.locked_by_run_id IS
  'UUID da execução do agente que adquiriu o lock. '
  'Pode ser NULL em implementações simples. '
  'Útil para diagnóstico de locks stale e auditoria.';

COMMENT ON COLUMN public.agent_processing_locks.acquired_at IS
  'Timestamp de aquisição. '
  'Locks com acquired_at > 5 minutos são considerados stale. '
  'Devem ser deletados antes de tentar novo lock.';
