-- =====================================================
-- Migration: Adicionar campos de IA em internal_notes
-- Data: 2026-05-07
--
-- Objetivo:
--   1. Adicionar colunas: source, ai_agent_id, is_editable, metadata
--   2. Substituir função protect_internal_note_immutable_fields
--      para bloquear edição de notas com is_editable = FALSE
--
-- Segurança:
--   - ADD COLUMN com DEFAULT garante retro-compatibilidade total
--   - Notas existentes recebem is_editable = TRUE automaticamente
--   - Novo bloco do trigger não usa auth.uid(): bloqueia via service_role
--   - RLS não é alterada
--   - Trigger trg_intnotes_protect continua com mesmo nome e timing
-- =====================================================


-- =====================================================
-- PARTE 1: ADD COLUMNS
-- Todas com IF NOT EXISTS para idempotência.
-- =====================================================

ALTER TABLE public.internal_notes
  ADD COLUMN IF NOT EXISTS source      TEXT,
  ADD COLUMN IF NOT EXISTS ai_agent_id UUID REFERENCES public.lovoo_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_editable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS metadata    JSONB;

COMMENT ON COLUMN public.internal_notes.source IS
  'Origem da nota. NULL = nota manual (legado). '
  '''ai:chat_summary'' = gerada por agente de resumo de conversa. '
  'Imutável em notas com is_editable = FALSE.';

COMMENT ON COLUMN public.internal_notes.ai_agent_id IS
  'FK para lovoo_agents. Preenchido apenas em notas geradas por agente de IA. '
  'NULL em notas manuais. ON DELETE SET NULL preserva a nota se o agente for removido.';

COMMENT ON COLUMN public.internal_notes.is_editable IS
  'Controla se a nota pode ser editada. '
  'TRUE (default) = nota manual, editável pelo autor. '
  'FALSE = nota de IA, imutável em todos os campos críticos. '
  'Imutável após criação: não pode ser alterado em nenhuma direção.';

COMMENT ON COLUMN public.internal_notes.metadata IS
  'Dados de rastreabilidade para notas de IA. '
  'Ex.: { conversation_id, generated_at, message_count }. '
  'Imutável em notas com is_editable = FALSE.';


-- =====================================================
-- PARTE 2: SUBSTITUIÇÃO DA FUNÇÃO DO TRIGGER
--
-- CREATE OR REPLACE: seguro, sem necessidade de recriar
-- o trigger trg_intnotes_protect.
--
-- Comportamento preservado (is_editable = TRUE):
--   - company_id, lead_id, opportunity_id, created_by, created_at → imutáveis
--   - content → apenas o autor pode editar (via auth.uid())
--   - updated_by = auth.uid() → setado automaticamente
--
-- Comportamento novo:
--   - is_editable → imutável após criação para TODAS as notas
--   - is_editable = FALSE: content, source, ai_agent_id, metadata também imutáveis
--     (sem dependência de auth.uid() — bloqueia inclusive via service_role)
--   - deleted_at, updated_at, updated_by → permitidos em qualquer nota
-- =====================================================

CREATE OR REPLACE FUNCTION public.protect_internal_note_immutable_fields()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $function$
BEGIN

  -- ── 1. Campos sempre imutáveis (todas as notas) ───────────────────────
  -- Mantém comportamento original integralmente.

  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION
      'internal_notes: company_id é imutável após criação. Operação bloqueada.';
  END IF;

  IF NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN
    RAISE EXCEPTION
      'internal_notes: lead_id é imutável após criação. '
      'Não é possível migrar uma nota entre entidades. Operação bloqueada.';
  END IF;

  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id THEN
    RAISE EXCEPTION
      'internal_notes: opportunity_id é imutável após criação. '
      'Não é possível migrar uma nota entre entidades. Operação bloqueada.';
  END IF;

  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION
      'internal_notes: created_by é imutável após criação. Operação bloqueada.';
  END IF;

  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'internal_notes: created_at é imutável após criação. Operação bloqueada.';
  END IF;

  -- ── 2. is_editable é imutável após criação (todas as notas) ──────────
  -- Impede tanto travar notas manuais (TRUE → FALSE) quanto
  -- destravar notas de IA (FALSE → TRUE). Não depende de auth.uid().

  IF NEW.is_editable IS DISTINCT FROM OLD.is_editable THEN
    RAISE EXCEPTION
      'internal_notes: is_editable é imutável após criação. Operação bloqueada.';
  END IF;

  -- ── 3. Notas de IA (is_editable = FALSE): campos adicionais imutáveis ─
  -- Incondicional: efetivo mesmo via service_role (auth.uid() = NULL não importa).
  -- Permitido: deleted_at (soft delete), updated_at, updated_by.

  IF OLD.is_editable = FALSE THEN

    IF NEW.content IS DISTINCT FROM OLD.content THEN
      RAISE EXCEPTION
        'internal_notes: nota de IA (is_editable=false) — '
        'content é imutável. Operação bloqueada.';
    END IF;

    IF NEW.source IS DISTINCT FROM OLD.source THEN
      RAISE EXCEPTION
        'internal_notes: nota de IA (is_editable=false) — '
        'source é imutável. Operação bloqueada.';
    END IF;

    IF NEW.ai_agent_id IS DISTINCT FROM OLD.ai_agent_id THEN
      RAISE EXCEPTION
        'internal_notes: nota de IA (is_editable=false) — '
        'ai_agent_id é imutável. Operação bloqueada.';
    END IF;

    IF NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      RAISE EXCEPTION
        'internal_notes: nota de IA (is_editable=false) — '
        'metadata é imutável. Operação bloqueada.';
    END IF;

  END IF;

  -- ── 4. Notas manuais (is_editable = TRUE): apenas o autor edita content ─
  -- Preserva comportamento existente. Com service_role: auth.uid() = NULL →
  -- NULL IS DISTINCT FROM qualquer UUID = TRUE → edição bloqueada (correto).

  IF OLD.is_editable = TRUE THEN
    IF NEW.content IS DISTINCT FROM OLD.content THEN
      IF auth.uid() IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION
          'internal_notes: apenas o autor pode editar o conteúdo da nota. Operação bloqueada.';
      END IF;
    END IF;
  END IF;

  -- ── 5. Atualizar updated_by (comportamento existente) ────────────────
  NEW.updated_by := auth.uid();

  RETURN NEW;

END;
$function$;
