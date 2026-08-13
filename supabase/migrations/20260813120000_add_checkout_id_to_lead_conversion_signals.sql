-- =============================================================================
-- Migration: adicionar checkout_id em lead_conversion_signals
--
-- Objetivo: permitir idempotência de conversion_signal por jornada Nuvemshop.
-- A identidade determinística da jornada é: company_id + checkout_id.
--
-- Regras:
--   - Coluna nullable: signals não-Nuvemshop continuam sem checkout_id.
--   - Índice UNIQUE parcial (WHERE checkout_id IS NOT NULL) garante que
--     para uma jornada Nuvemshop (company + checkout) exista no máximo
--     um signal — evita duplicatas por retry, Worker reiniciado ou
--     multiple customer:update.
--   - Não modifica registros existentes.
--   - Não remove nenhuma coluna ou constraint existente.
-- =============================================================================

ALTER TABLE public.lead_conversion_signals
  ADD COLUMN IF NOT EXISTS checkout_id text;

-- Índice parcial: unicidade apenas quando checkout_id está preenchido.
-- Signals sem checkout_id (fluxos anteriores/não-Nuvemshop) não são afetados.
CREATE UNIQUE INDEX IF NOT EXISTS uq_lcs_company_checkout
  ON public.lead_conversion_signals (company_id, checkout_id)
  WHERE checkout_id IS NOT NULL;

-- Índice de suporte para lookup por checkout_id (consumer e dedup check).
CREATE INDEX IF NOT EXISTS idx_lcs_checkout_id
  ON public.lead_conversion_signals (checkout_id)
  WHERE checkout_id IS NOT NULL;
