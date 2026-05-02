-- =====================================================
-- Migration: add_last_interaction_at_to_opportunities
--
-- Objetivo: base técnica para cálculo de "última interação real",
-- sem impacto de performance no dashboard.
--
-- Coluna: opportunities.last_interaction_at
-- Atualização: triggers AFTER INSERT em 3 tabelas (deferred, leve)
-- Fallback: se NULL → usar updated_at (definido na camada de consulta)
--
-- Triggers:
--   A. chat_messages  → via chat_conversations.lead_id
--   B. lead_activities → via lead_id + company_id
--   C. opportunity_stage_history → via opportunity_id (direto)
-- =====================================================

-- 1. Adicionar coluna
ALTER TABLE public.opportunities
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz NULL;

-- 2. Backfill: popula dados existentes com updated_at como baseline
--    Seguro: COALESCE evita sobrescrever valores já preenchidos
UPDATE public.opportunities
SET last_interaction_at = updated_at
WHERE last_interaction_at IS NULL
  AND updated_at IS NOT NULL;

-- 3. Índice para consultas de cooling/insights por empresa + data
CREATE INDEX IF NOT EXISTS idx_opportunities_last_interaction
  ON public.opportunities (company_id, last_interaction_at)
  WHERE last_interaction_at IS NOT NULL;

-- =====================================================
-- Trigger A: chat_messages → oportunidades do lead
-- Caminho: chat_messages.conversation_id
--        → chat_conversations.lead_id
--        → opportunities.lead_id + company_id
-- =====================================================

CREATE OR REPLACE FUNCTION public.trg_fn_chat_messages_update_last_interaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.opportunities o
  SET last_interaction_at = GREATEST(
    COALESCE(o.last_interaction_at, '-infinity'::timestamptz),
    NEW.created_at
  )
  FROM public.chat_conversations cc
  WHERE cc.id        = NEW.conversation_id
    AND o.lead_id    = cc.lead_id
    AND o.company_id = cc.company_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_messages_update_last_interaction
  ON public.chat_messages;

CREATE TRIGGER trg_chat_messages_update_last_interaction
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_chat_messages_update_last_interaction();

-- =====================================================
-- Trigger B: lead_activities → oportunidades do lead
-- Caminho: lead_activities.lead_id + company_id
--        → opportunities.lead_id + company_id
-- =====================================================

CREATE OR REPLACE FUNCTION public.trg_fn_lead_activities_update_last_interaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.opportunities
  SET last_interaction_at = GREATEST(
    COALESCE(last_interaction_at, '-infinity'::timestamptz),
    NEW.created_at
  )
  WHERE lead_id    = NEW.lead_id
    AND company_id = NEW.company_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_activities_update_last_interaction
  ON public.lead_activities;

CREATE TRIGGER trg_lead_activities_update_last_interaction
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_lead_activities_update_last_interaction();

-- =====================================================
-- Trigger C: opportunity_stage_history → oportunidade direta
-- Caminho: opportunity_stage_history.opportunity_id → opportunities.id
-- Mais eficiente: PK lookup direto
-- =====================================================

CREATE OR REPLACE FUNCTION public.trg_fn_stage_history_update_last_interaction()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.opportunities
  SET last_interaction_at = GREATEST(
    COALESCE(last_interaction_at, '-infinity'::timestamptz),
    NEW.created_at
  )
  WHERE id = NEW.opportunity_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_stage_history_update_last_interaction
  ON public.opportunity_stage_history;

CREATE TRIGGER trg_stage_history_update_last_interaction
  AFTER INSERT ON public.opportunity_stage_history
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_stage_history_update_last_interaction();
