-- =============================================================================
-- FASE 5.4.1 — Hotfix: recriar constraint uq_dashboard_snapshots com
--              NULLS NOT DISTINCT (PostgreSQL 15+)
--
-- Problema: UNIQUE (company_id, funnel_id, period_start) sem NULLS NOT DISTINCT
-- trata todos os valores NULL como distintos entre si. Portanto, o
-- ON CONFLICT ON CONSTRAINT uq_dashboard_snapshots da RPC
-- generate_dashboard_daily_snapshot nunca disparava para funnel_id IS NULL,
-- transformando todo UPSERT em INSERT duplicado.
--
-- Correção: NULLS NOT DISTINCT faz com que dois NULLs sejam considerados iguais
-- na constraint, ativando o ON CONFLICT para funnel_id IS NULL.
--
-- ATENÇÃO: executar SOMENTE após a migration 20260609180001 (limpeza de duplicatas).
-- Se houver duplicatas na tabela, o ADD CONSTRAINT falhará.
-- =============================================================================

ALTER TABLE dashboard_snapshots
  DROP CONSTRAINT uq_dashboard_snapshots;

ALTER TABLE dashboard_snapshots
  ADD CONSTRAINT uq_dashboard_snapshots
    UNIQUE NULLS NOT DISTINCT (company_id, funnel_id, period_start);
