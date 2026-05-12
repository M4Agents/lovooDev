// =====================================================
// DeltaBadge — Badge de variação histórica (WoW/MoM).
//
// Regras de cor contextual:
//   higher_is_better=true  → up=verde, down=vermelho
//   higher_is_better=false → up=vermelho, down=verde (SLA, tempo de resp.)
//
// Exibição secundária: histórico sempre em segundo plano visual.
// Fonte pequena, cor menos saturada que os valores realtime.
// =====================================================

import React from 'react'

type DeltaDirection = 'up' | 'down' | 'neutral'

export interface DeltaBadgeProps {
  /** Variação percentual — null = sem dados */
  pct:              number | null
  /** Se aumentar é bom (leads, receita = true; SLA, tempo = false) */
  higherIsBetter?:  boolean
  /** Rótulo de período para tooltip — ex: "vs 04/05 – 10/05" */
  periodLabel?:     string
  className?:       string
}

function getDirection(pct: number | null): DeltaDirection {
  if (pct === null) return 'neutral'
  if (pct > 0.05)  return 'up'
  if (pct < -0.05) return 'down'
  return 'neutral'
}

const ARROW: Record<DeltaDirection, string> = {
  up:      '↑',
  down:    '↓',
  neutral: '→',
}

function getColorClasses(direction: DeltaDirection, higherIsBetter: boolean): string {
  if (direction === 'neutral') return 'text-gray-400'
  const isGood = (direction === 'up') === higherIsBetter
  if (isGood) return 'text-emerald-600'
  return 'text-rose-500'
}

export const DeltaBadge: React.FC<DeltaBadgeProps> = ({
  pct,
  higherIsBetter = true,
  periodLabel,
  className = '',
}) => {
  if (pct === null) return null

  const direction   = getDirection(pct)
  const colorClass  = getColorClasses(direction, higherIsBetter)
  const arrow       = ARROW[direction]
  const absValue    = Math.abs(pct)
  const label       = absValue < 0.1 ? '0%' : `${absValue.toFixed(1)}%`

  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${colorClass} ${className}`}
      title={periodLabel ? `Variação ${periodLabel}` : undefined}
    >
      <span aria-hidden="true">{arrow}</span>
      <span>{label}</span>
    </span>
  )
}
