-- =====================================================
-- MIGRATION: Estender ai_agent_execution_logs para suportar conversação
-- Data: 2026-04-09
-- Etapa: 10/13
--
-- Propósito:
--   1. Adicionar campos de rastreabilidade de conversação (conversation_id,
--      session_id, assignment_id, rule_id) que estavam ausentes da migration original.
--   2. Expandir o CHECK constraint de status para incluir novos valores
--      necessários para o sistema de agentes conversacionais.
--
-- Estratégia para o CHECK constraint de status:
--   A migration original definiu o CHECK inline, sem nome explícito.
--   PostgreSQL gera um nome automático (geralmente: table_column_check).
--   Para garantir segurança em qualquer ambiente (dev, staging, prod),
--   o nome é descoberto dinamicamente via pg_constraint antes de ser dropado.
--   Após o DROP, um novo constraint nomeado explicitamente é adicionado.
--
-- Compatibilidade retroativa:
--   - ADD COLUMN com NULL ou DEFAULT → não afeta linhas existentes
--   - DROP + ADD CONSTRAINT → apenas adiciona valores novos ao enum de texto
--   - Todos os valores anteriores são mantidos no novo CHECK
--
-- Dependências:
--   Migration 8 (agent_conversation_sessions) para session_id FK
--   Migration 4 (company_agent_assignments) para assignment_id FK
--   Migration 5 (agent_routing_rules) para rule_id FK
-- =====================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Adicionar campos de rastreabilidade de conversação
-- ─────────────────────────────────────────────────────────────────────────────

-- conversation_id: qual conversa esta execução atendeu
-- Sem FK intencional: logs devem sobreviver à remoção de conversas arquivadas
ALTER TABLE public.ai_agent_execution_logs
  ADD COLUMN IF NOT EXISTS conversation_id UUID NULL;

-- session_id: qual sessão de conversação estava ativa
-- FK com ON DELETE SET NULL: log preservado mesmo se sessão for purged
ALTER TABLE public.ai_agent_execution_logs
  ADD COLUMN IF NOT EXISTS session_id UUID NULL
    REFERENCES public.agent_conversation_sessions(id) ON DELETE SET NULL;

-- assignment_id: qual configuração de agente foi usada
-- FK com ON DELETE SET NULL: log preservado mesmo se assignment for removido
ALTER TABLE public.ai_agent_execution_logs
  ADD COLUMN IF NOT EXISTS assignment_id UUID NULL
    REFERENCES public.company_agent_assignments(id) ON DELETE SET NULL;

-- rule_id: qual regra de roteamento selecionou este assignment
-- FK com ON DELETE SET NULL: log preservado mesmo se a regra for desativada/removida
ALTER TABLE public.ai_agent_execution_logs
  ADD COLUMN IF NOT EXISTS rule_id UUID NULL
    REFERENCES public.agent_routing_rules(id) ON DELETE SET NULL;

-- Índice para rastreabilidade por conversa (debugging de sessões de IA)
CREATE INDEX IF NOT EXISTS idx_ai_agent_logs_conversation
  ON public.ai_agent_execution_logs (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

-- Índice para análise por assignment (quais agentes executaram mais/com mais erro)
CREATE INDEX IF NOT EXISTS idx_ai_agent_logs_assignment
  ON public.ai_agent_execution_logs (assignment_id, created_at DESC)
  WHERE assignment_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Expandir o CHECK constraint de status
--
-- O constraint original foi criado inline (sem nome explícito) na migration
-- 20260407220000_ai_agent_execution_logs.sql.
--
-- Estratégia:
--   a) Descobrir o nome atual via pg_constraint (sem hardcode)
--   b) Dropar o constraint pelo nome descoberto
--   c) Adicionar novo constraint com nome explícito e lista completa de valores
--
-- ATENÇÃO: Este bloco é idempotente — se o novo constraint já existir
-- (ex: migration re-executada), o DO-BLOCK ignora graciosamente.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Descobrir o nome do CHECK constraint atual na coluna status
  -- Filtramos por conrelid (tabela) e contype 'c' (check)
  -- Se houver múltiplos checks, pegamos especificamente o que menciona a coluna 'status'
  SELECT c.conname INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid
    AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.ai_agent_execution_logs'::regclass
    AND c.contype  = 'c'
    AND a.attname  = 'status'
  LIMIT 1;

  -- Dropar apenas se encontrado (segurança para re-execução)
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.ai_agent_execution_logs DROP CONSTRAINT %I',
      v_constraint_name
    );
    RAISE NOTICE 'Dropped constraint: %', v_constraint_name;
  ELSE
    RAISE NOTICE 'No status CHECK constraint found — skipping drop';
  END IF;
END $$;

-- Adicionar novo constraint nomeado explicitamente com todos os valores válidos
-- Inclui os 7 valores originais + 1 novo para agentes conversacionais
ALTER TABLE public.ai_agent_execution_logs
  ADD CONSTRAINT ai_agent_logs_status_check
  CHECK (status IN (
    -- Valores originais (preservados intactos)
    'success',
    'fallback_no_agent',
    'fallback_openai_unavailable',
    'fallback_openai_failed',
    'error_missing_context',
    'error_openai',
    'error_db',
    -- Novo valor para o sistema de agentes conversacionais:
    -- execução bloqueada por AgentCapability não satisfeita
    'blocked_by_capability'
  ));

COMMENT ON COLUMN public.ai_agent_execution_logs.conversation_id IS
  'Conversa do chat onde a execução ocorreu. '
  'NULL para execuções fora do contexto de chat (ex: geração de campo de produto). '
  'Sem FK intencional — preserva log mesmo se conversa for arquivada.';

COMMENT ON COLUMN public.ai_agent_execution_logs.session_id IS
  'Sessão de conversação ativa no momento da execução. '
  'NULL para execuções fora de sessão de agente conversacional.';

COMMENT ON COLUMN public.ai_agent_execution_logs.assignment_id IS
  'company_agent_assignment que configurou esta execução. '
  'NULL para execuções de agentes SaaS (lovoo_agents sem assignment por empresa).';

COMMENT ON COLUMN public.ai_agent_execution_logs.rule_id IS
  'Regra de roteamento que selecionou o assignment para esta execução. '
  'NULL quando a execução não passou pelo Router de conversação.';
