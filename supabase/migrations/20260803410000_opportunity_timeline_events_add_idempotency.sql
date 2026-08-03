-- =============================================================================
-- Nuvemshop Integration — Migration Fase 11
-- Idempotência na tabela opportunity_timeline_events
--
-- Adiciona coluna idempotency_key para garantir que eventos de fulfillment
-- (e outros eventos de integração externa) não sejam duplicados quando o mesmo
-- webhook for recebido mais de uma vez.
--
-- Estratégia de chave de idempotência para eventos Nuvemshop:
--   'nuvemshop:{nuvemshop_order_id}:{event_type}'
--   Exemplo: 'nuvemshop:123456:order_packed'
--
-- A coluna é nullable para não quebrar eventos de timeline existentes que
-- não possuem chave de idempotência (eventos criados por humanos ou outros
-- sistemas que não precisam de deduplicação automática).
--
-- O índice UNIQUE é PARTIAL (WHERE idempotency_key IS NOT NULL) para garantir
-- que apenas as linhas com chave explícita sejam deduplicadas, sem afetar
-- os eventos existentes sem chave.
-- =============================================================================

ALTER TABLE public.opportunity_timeline_events
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN public.opportunity_timeline_events.idempotency_key IS
  'Chave de idempotência para deduplicação de eventos de integração externa. '
  'Padrão Nuvemshop: "nuvemshop:{order_id}:{event_type}". '
  'NULL em eventos manuais ou sem necessidade de deduplicação.';

-- Índice UNIQUE parcial: aplica deduplicação somente onde há chave explícita
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_events_idempotency
  ON public.opportunity_timeline_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
