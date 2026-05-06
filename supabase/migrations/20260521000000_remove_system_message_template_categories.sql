-- =============================================================================
-- Migration: remove_system_message_template_categories
-- Data: 2026-05-21
--
-- Remove as categorias padrão globais (Vendas, Suporte, Atendimento) que foram
-- criadas como is_system=true na migration anterior.
--
-- Decisão de produto: categorias são criadas exclusivamente por cada empresa.
-- Não existem mais categorias globais compartilhadas entre empresas.
--
-- Pré-condição validada antes da execução:
--   SELECT COUNT(*) FROM message_templates mt
--   JOIN message_template_categories c ON c.id = mt.category_id
--   WHERE c.is_system = true;
--   → Resultado: 0 (nenhum template vinculado — deleção direta, sem migração de dados)
--
-- O que esta migration faz:
--   1. DELETE nas 3 categorias system (Vendas, Suporte, Atendimento)
--   2. DROP INDEX uq_mtc_system_name (sem uso sem rows is_system=true)
--
-- O que esta migration NÃO altera:
--   ✗ Coluna is_system (mantida — trigger de imutabilidade continua ativo)
--   ✗ Constraint mtc_system_requires_null_company (mantida — sem impacto)
--   ✗ Trigger protect_message_template_category_fields (mantido)
--   ✗ Trigger validate_message_template_category (mantido)
--   ✗ RLS (mantida — policies já exigem is_system=false para escrita)
--   ✗ Índice uq_mtc_custom_company_name (mantido — protege custom per-company)
-- =============================================================================


-- ── 1. Verificação de segurança: confirmar que nenhum template está vinculado ──

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*)
    INTO v_count
    FROM public.message_templates mt
    JOIN public.message_template_categories c ON c.id = mt.category_id
   WHERE c.is_system = true;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'remove_system_categories: % template(s) ainda vinculado(s) a categorias system. '
      'Execute migração de dados antes de remover as categorias.',
      v_count;
  END IF;
END;
$$;


-- ── 2. Remover categorias system ─────────────────────────────────────────────

DELETE FROM public.message_template_categories
WHERE is_system = true;


-- ── 3. Remover índice uq_mtc_system_name (obsoleto sem rows is_system=true) ──

DROP INDEX IF EXISTS public.uq_mtc_system_name;


-- ── 4. Verificação final ──────────────────────────────────────────────────────

DO $$
DECLARE
  v_system_remaining integer;
  v_index_exists     boolean;
BEGIN
  SELECT COUNT(*) INTO v_system_remaining
    FROM public.message_template_categories
   WHERE is_system = true;

  IF v_system_remaining > 0 THEN
    RAISE EXCEPTION
      'remove_system_categories: ainda existem % categorias system após DELETE.',
      v_system_remaining;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_mtc_system_name'
  ) INTO v_index_exists;

  IF v_index_exists THEN
    RAISE EXCEPTION 'remove_system_categories: índice uq_mtc_system_name ainda existe após DROP.';
  END IF;

  RAISE LOG '=== remove_system_message_template_categories aplicada com sucesso ===';
  RAISE LOG '  Categorias system removidas (Vendas, Suporte, Atendimento)';
  RAISE LOG '  Índice uq_mtc_system_name removido';
  RAISE LOG '  Estrutura da tabela preservada (is_system, triggers, RLS, uq_mtc_custom_company_name)';
END;
$$;
