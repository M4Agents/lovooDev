-- =============================================================================
-- MIGRATION: Adicionar company_id a agent_processing_locks e corrigir PK
-- Data: 2026-07-15
-- Etapa: 13.1 — Parte A
--
-- PROBLEMA:
--   A tabela agent_processing_locks usava conversation_id como PK isolado.
--   Embora conversation_id seja UUID globalmente único (sem colisão cross-tenant),
--   a ausência de company_id nas queries impedia:
--     1. Filtro explícito multi-tenant (defense-in-depth)
--     2. Liberação segura com prova de posse (runId + company_id)
--
--   Também havia um bug na liberação: releaseConversationLock fazia DELETE apenas
--   por conversation_id, sem filtrar locked_by_run_id. Isso permitia que um worker
--   liberasse o lock adquirido por outro worker diferente.
--
-- SOLUÇÃO:
--   1. Adicionar company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE
--   2. Alterar PK de (conversation_id) para (company_id, conversation_id)
--   3. Queries JS atualizadas para filtrar por company_id + conversation_id + runId
--
-- SAFETY:
--   - Agents não estão ativos; nenhuma empresa usa o agente de IA.
--   - Tabela deve estar vazia; verificação obrigatória antes de aplicar.
--   - Operação confirmada segura: zero registros, zero impacto em produção.
--
-- ROLLBACK:
--   ALTER TABLE public.agent_processing_locks DROP CONSTRAINT IF EXISTS agent_processing_locks_pkey;
--   ALTER TABLE public.agent_processing_locks DROP COLUMN IF EXISTS company_id;
--   ALTER TABLE public.agent_processing_locks ADD PRIMARY KEY (conversation_id);
-- =============================================================================

DO $$
DECLARE
  v_lock_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_lock_count FROM public.agent_processing_locks;

  IF v_lock_count > 0 THEN
    RAISE EXCEPTION
      'MIGRATION ABORTADA: agent_processing_locks possui % registros ativos. '
      'Confirme que todos os agentes estão parados antes de aplicar esta migration.',
      v_lock_count
    USING ERRCODE = 'P0001';
  END IF;

  RAISE NOTICE 'agent_processing_locks está vazia (% registros). Prosseguindo.', v_lock_count;
END;
$$;

-- ── PASSO 1: Remover PK existente (conversation_id isolado) ──────────────────

ALTER TABLE public.agent_processing_locks
  DROP CONSTRAINT IF EXISTS agent_processing_locks_pkey;

-- ── PASSO 2: Adicionar company_id ────────────────────────────────────────────
--
-- FK para companies(id) com ON DELETE CASCADE:
--   Se a empresa for excluída, os locks ativos dela são removidos.
--   Comportamento consistente com demais tabelas de operação.

ALTER TABLE public.agent_processing_locks
  ADD COLUMN IF NOT EXISTS company_id UUID
    REFERENCES public.companies(id) ON DELETE CASCADE;

-- A tabela está vazia — não precisa de UPDATE para popular company_id.
-- Em tabelas com dados, seria: UPDATE ... SET company_id = cc.company_id
-- FROM chat_conversations cc WHERE cc.id = conversation_id;

-- Tornar NOT NULL agora que sabemos que está vazia
ALTER TABLE public.agent_processing_locks
  ALTER COLUMN company_id SET NOT NULL;

-- ── PASSO 3: Nova PK composta (company_id, conversation_id) ──────────────────
--
-- A constraint única agora reflete explicitamente o isolamento multi-tenant.
-- UUID de conversation_id ainda é globalmente único, mas a constraint documentar
-- a intenção de que o lock é por (tenant, conversa).

ALTER TABLE public.agent_processing_locks
  ADD PRIMARY KEY (company_id, conversation_id);

-- ── PASSO 4: Índice adicional para queries por company_id ────────────────────

CREATE INDEX IF NOT EXISTS idx_processing_locks_company_id
  ON public.agent_processing_locks (company_id);

-- ── PASSO 5: Atualizar comentários ───────────────────────────────────────────

COMMENT ON TABLE public.agent_processing_locks IS
  'Travas de processamento por conversa para o agente de IA. '
  'Garante que apenas uma execução processe uma conversa por vez. '
  'PK composta (company_id, conversation_id) — isolamento multi-tenant explícito. '
  'INSERT com verificação de conflito é a operação principal (lock atômico). '
  'Locks stale (acquired_at muito antigo) são limpos antes de novo acquire. '
  'Liberação exige company_id + conversation_id + locked_by_run_id (prova de posse). '
  'Acesso exclusivo via service_role — RLS sem policies bloqueia frontend.';

COMMENT ON COLUMN public.agent_processing_locks.company_id IS
  'UUID da empresa dona da conversa. '
  'Obrigatório para isolamento multi-tenant explícito. '
  'FK para companies(id) ON DELETE CASCADE.';

COMMENT ON COLUMN public.agent_processing_locks.conversation_id IS
  'UUID da conversa sob lock. '
  'FK para chat_conversations(id) ON DELETE CASCADE. '
  'Junto com company_id forma a PK composta.';

COMMENT ON COLUMN public.agent_processing_locks.locked_by_run_id IS
  'UUID da execução que detém o lock. '
  'Obrigatório na liberação (prova de posse): '
  'DELETE ... WHERE run_id = locked_by_run_id previne que outro worker '
  'libere um lock que não adquiriu.';
