-- =====================================================
-- Migration: formaliza coluna timeout_at em automation_executions
--
-- O executor (executor.js) já escreve e lê timeout_at desde a
-- implementação do nó user_input. Esta migration garante que a
-- coluna exista formalmente no schema, evitando inconsistência
-- entre o código e as migrations registradas.
--
-- Segura para re-execução: ADD COLUMN IF NOT EXISTS não falha
-- se a coluna já existir (adicionada implicitamente pelo executor).
-- =====================================================

ALTER TABLE public.automation_executions
  ADD COLUMN IF NOT EXISTS timeout_at timestamptz NULL;

COMMENT ON COLUMN public.automation_executions.timeout_at IS
  'Data/hora em que a execução pausada deve expirar por timeout (nó user_input). '
  'Setada pelo executor.js ao pausar; zerada ao retomar.';
