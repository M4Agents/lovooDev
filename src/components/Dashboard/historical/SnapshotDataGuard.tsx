// =====================================================
// SnapshotDataGuard — Guard de dados históricos.
//
// Regras de exibição (ordem de prioridade):
//   1. enabled = false → oculta (flag desligada)
//   2. canUseSnapshots = false → oculta (tenant não habilitado para FASE 4.2)
//   3. freshnessOk = false → oculta (snapshot stale/missing)
//   4. dataPoints < minPoints → oculta (dados insuficientes — D4)
//
// Em todos os casos, oculta SILENCIOSAMENTE:
//   - Sem erro para o usuário
//   - Sem placeholder
//   - Sem nenhum indicador visual
//
// FASE 4.1.5: adicionada prop freshnessOk para gate de freshness.
// FASE 4.2 Sprint 1A: adicionada prop canUseSnapshots para gating por tenant.
//   canUseSnapshots = classification === 'healthy' && maturityStatus === 'mature' && ready
//   Tenants insufficient_history, degraded e critical retornam null silenciosamente.
// =====================================================

import React from 'react'

export interface SnapshotDataGuardProps {
  /** Número de pontos disponíveis */
  dataPoints:       number
  /** Mínimo para exibir (padrão: 5 conforme D4) */
  minPoints?:       number
  /** Se false, nunca renderiza (flag desligada) */
  enabled?:         boolean
  /**
   * FASE 4.2 Sprint 1A — Tenant pode usar snapshots históricos.
   * Se false, oculta silenciosamente (insufficient_history, degraded, critical).
   * Se undefined, não aplica gate de tenant (comportamento anterior).
   */
  canUseSnapshots?: boolean
  /**
   * FASE 4.1.5 — Status de freshness do snapshot.
   * Se false, oculta o componente (snapshot stale ou ausente).
   * Se undefined, não aplica gate de freshness (comportamento anterior).
   */
  freshnessOk?:     boolean
  children:         React.ReactNode
}

export const SnapshotDataGuard: React.FC<SnapshotDataGuardProps> = ({
  dataPoints,
  minPoints       = 5,
  enabled         = true,
  canUseSnapshots,
  freshnessOk,
  children,
}) => {
  if (!enabled)                          return null
  if (canUseSnapshots === false)         return null
  if (freshnessOk === false)             return null
  if (dataPoints < minPoints)            return null
  return <>{children}</>
}
