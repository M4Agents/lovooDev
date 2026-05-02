-- =====================================================
-- Migration: índices de performance para o Dashboard
--
-- Aplicados com IF NOT EXISTS — idempotentes.
-- Nota: CONCURRENTLY não é suportado dentro de transaction
-- de migration; use-o manualmente em produção se necessário.
-- =====================================================

-- ─── opportunities: filtro composto company_id + updated_at ───────────────
-- Usado em buildBaseQuery (dashboard/opportunities.ts) para o range de período.
-- Sem este índice, Postgres usa idx_opportunities_company e depois filtra
-- os resultados por updated_at com table scan parcial.

CREATE INDEX IF NOT EXISTS idx_opportunities_company_updated_at
  ON public.opportunities (company_id, updated_at DESC);

-- ─── opportunities: filtro composto company_id + status + probability ─────
-- Usado nos insights hot_opportunity e cooling_opportunity que filtram
-- status = 'open' AND probability >= 70 dentro da mesma empresa.

CREATE INDEX IF NOT EXISTS idx_opportunities_company_status_prob
  ON public.opportunities (company_id, status, probability DESC);

-- ─── opportunity_funnel_positions: filtro composto funnel_id + stage_id ───
-- Usado no pré-filtro de posições (passo 6 de opportunities.ts) quando
-- ambos funnel_id e stage_id são fornecidos simultaneamente.

CREATE INDEX IF NOT EXISTS idx_opp_positions_funnel_stage
  ON public.opportunity_funnel_positions (funnel_id, stage_id);
