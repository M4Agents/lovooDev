-- =====================================================
-- FASE 3A — Índices de suporte
-- Otimizam as queries de forecast, priority alerts e funnel executive.
-- =====================================================

-- Oportunidades abertas: queries de forecast + priority alerts + alerts_count
-- Cobre: company_id + status + probability + last_interaction_at
CREATE INDEX IF NOT EXISTS idx_opportunities_company_open_prob
  ON opportunities (company_id, probability, last_interaction_at NULLS FIRST)
  WHERE status = 'open';

-- Histórico de etapas: suporte ao avg_days no funnel executive
-- funnel_id existe diretamente na tabela; colunas: stage_entered_at, stage_left_at
CREATE INDEX IF NOT EXISTS idx_osh_funnel_stage_entered
  ON opportunity_stage_history (funnel_id, to_stage_id, stage_entered_at);
