// =====================================================
// SnapshotDataGuard — Guard de dados históricos.
//
// Regras de exibição (ordem de prioridade):
//   1. enabled = false → oculta (flag desligada)
//   2. freshnessOk = false → oculta (snapshot stale/missing)
//   3. dataPoints < minPoints → oculta (dados insuficientes — D4)
//
// Em todos os casos, oculta SILENCIOSAMENTE:
//   - Sem erro para o usuário
//   - Sem placeholder
//   - Sem nenhum indicador visual
//
// FASE 4.1.5: adicionada prop freshnessOk para gate de freshness.
// Quando freshnessOk = false, os componentes históricos desaparecem
// sem que o usuário perceba — realtime segue como source of truth.
// =====================================================

import React from 'react'

export interface SnapshotDataGuardProps {
  /** Número de pontos disponíveis */
  dataPoints:    number
  /** Mínimo para exibir (padrão: 5 conforme D4) */
  minPoints?:    number
  /** Se false, nunca renderiza (flag desligada) */
  enabled?:      boolean
  /**
   * FASE 4.1.5 — Status de freshness do snapshot.
   * Se false, oculta o componente (snapshot stale ou ausente).
   * Se undefined, não aplica gate de freshness (comportamento anterior).
   */
  freshnessOk?:  boolean
  children:      React.ReactNode
}

export const SnapshotDataGuard: React.FC<SnapshotDataGuardProps> = ({
  dataPoints,
  minPoints    = 5,
  enabled      = true,
  freshnessOk,
  children,
}) => {
  if (!enabled)                          return null
  if (freshnessOk === false)             return null
  if (dataPoints < minPoints)            return null
  return <>{children}</>
}
