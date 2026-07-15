-- =====================================================
-- MIGRATION: Adicionar 'buffered' ao CHECK de agent_processed_messages.result
-- Data: 2026-07-14
-- Funcionalidade: Agrupamento de Mensagens — Agente Conversacional (Migration A)
--
-- Propósito:
--   Permitir que mensagens enfileiradas no buffer de agrupamento sejam
--   registradas em agent_processed_messages com result = 'buffered'.
--   Isso preserva a deduplicação atômica (INSERT com ON CONFLICT) enquanto
--   indica que a mensagem aguarda processamento em lote, não foi descartada.
--
-- Valores aceitos após esta migration:
--   'processed'               — agente executou e respondeu
--   'skipped_no_rule'         — nenhuma regra de roteamento encontrada
--   'skipped_ai_inactive'     — ai_state != 'ai_active'
--   'skipped_lock_busy'       — lock de processamento ocupado
--   'skipped_out_of_schedule' — fora do horário de atendimento
--   'error'                   — erro durante execução
--   'buffered'                — mensagem enfileirada para agrupamento (NOVO)
--
-- Compatibilidade:
--   Aditivo: apenas adiciona um valor ao enum. Não altera dados existentes.
--   Nenhum código existente escreve 'buffered' — sem risco de regressão.
--
-- Dependências:
--   20260409103000_create_agent_processed_messages.sql
--   20260516160000_add_operating_schedule_to_agent_assignments.sql
--
-- Rollback: ver instruções ao final deste arquivo.
-- =====================================================

-- ── Ampliar CHECK constraint: adicionar 'buffered' ────────────────────────────
-- Segue o mesmo padrão da migration 20260516160000:
--   1. Verificar existência da constraint antes de remover (seguro para reexecução)
--   2. Recriar com o conjunto completo de valores + 'buffered'

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  constraint_name = 'agent_processed_messages_result_check'
      AND  table_name      = 'agent_processed_messages'
      AND  constraint_type = 'CHECK'
  ) THEN
    ALTER TABLE public.agent_processed_messages
      DROP CONSTRAINT agent_processed_messages_result_check;
  END IF;
END $$;

ALTER TABLE public.agent_processed_messages
  ADD CONSTRAINT agent_processed_messages_result_check
  CHECK (result IN (
    'processed',
    'skipped_no_rule',
    'skipped_ai_inactive',
    'skipped_lock_busy',
    'skipped_out_of_schedule',
    'error',
    'buffered'
  ));

-- ── Atualizar comentário da coluna ───────────────────────────────────────────

COMMENT ON COLUMN public.agent_processed_messages.result IS
  'Resultado do processamento: '
  'processed = agente executou e respondeu. '
  'skipped_no_rule = nenhuma regra de roteamento encontrada. '
  'skipped_ai_inactive = ai_state != ai_active. '
  'skipped_lock_busy = lock de processamento ocupado. '
  'skipped_out_of_schedule = fora do horário de atendimento. '
  'error = falha durante execução. '
  'buffered = mensagem enfileirada para agrupamento de mensagens (message grouping).';

-- =====================================================
-- ROLLBACK MANUAL (não executar automaticamente)
--
-- Para reverter esta migration:
--
-- PASSO 1 — Garantir que não existam registros com result = 'buffered'.
--   Desativar a feature primeiro (message_grouping_window_s = 0 em todos os agentes).
--   Aguardar processamento dos lotes pendentes.
--   Então atualizar registros remanescentes:
--
--   UPDATE public.agent_processed_messages
--     SET result = 'error'
--     WHERE result = 'buffered';
--
-- PASSO 2 — Restaurar o CHECK sem 'buffered':
--
--   DO $$
--   BEGIN
--     IF EXISTS (
--       SELECT 1 FROM information_schema.table_constraints
--       WHERE constraint_name = 'agent_processed_messages_result_check'
--         AND table_name      = 'agent_processed_messages'
--         AND constraint_type = 'CHECK'
--     ) THEN
--       ALTER TABLE public.agent_processed_messages
--         DROP CONSTRAINT agent_processed_messages_result_check;
--     END IF;
--   END $$;
--
--   ALTER TABLE public.agent_processed_messages
--     ADD CONSTRAINT agent_processed_messages_result_check
--     CHECK (result IN (
--       'processed',
--       'skipped_no_rule',
--       'skipped_ai_inactive',
--       'skipped_lock_busy',
--       'skipped_out_of_schedule',
--       'error'
--     ));
--
-- PASSO 3 — Restaurar o comentário da coluna (opcional):
--
--   COMMENT ON COLUMN public.agent_processed_messages.result IS
--     'Resultado do processamento: '
--     'processed = agente executou. '
--     'skipped_* = descartado por razão específica. '
--     'error = falha durante execução.';
-- =====================================================
