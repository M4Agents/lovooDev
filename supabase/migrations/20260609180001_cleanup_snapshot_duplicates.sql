-- =============================================================================
-- FASE 5.4.1 — Hotfix: limpeza de duplicatas em dashboard_snapshots
--
-- Problema: a constraint uq_dashboard_snapshots sem NULLS NOT DISTINCT permitia
-- múltiplas linhas para o mesmo (company_id, period_start) quando funnel_id IS NULL.
-- O cron gerava D-1/D-2/D-3 a cada execução, acumulando até 7 linhas por dia.
--
-- Esta migration remove as linhas excedentes, mantendo apenas o snapshot mais
-- recente por (company_id, period_start) para funnel_id IS NULL.
--
-- Linhas com funnel_id IS NOT NULL NÃO são tocadas (constraint já funcionava).
--
-- Resultado esperado: 788 linhas removidas, 0 duplicatas restantes.
-- =============================================================================

DELETE FROM dashboard_snapshots
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY company_id, period_start
        ORDER BY snapshot_taken_at DESC
      ) AS rn
    FROM dashboard_snapshots
    WHERE funnel_id IS NULL
  ) ranked
  WHERE rn > 1
);
