// =====================================================
// TrendSparkline — Minigráfico SVG de tendência.
//
// SVG puro — sem biblioteca.
// Recebe array de valores numéricos (7 pontos ideais).
// Exibição sempre visível se dados suficientes.
// Cor da linha baseada em tendência geral (primeiro vs último).
//
// Regras:
//   - Mínimo 2 pontos para renderizar
//   - higherIsBetter afeta a cor da linha de tendência
// =====================================================

import React, { useMemo } from 'react'

export interface TrendSparklineProps {
  /** Array de valores — idealmente 7 pontos (1 por dia) */
  values:          number[]
  /** Se aumentar é bom (afeta a cor da linha) */
  higherIsBetter?: boolean
  width?:          number
  height?:         number
  className?:      string
}

export const TrendSparkline: React.FC<TrendSparklineProps> = ({
  values,
  higherIsBetter = true,
  width  = 80,
  height = 28,
  className = '',
}) => {
  const points = useMemo(() => {
    if (values.length < 2) return null

    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min

    // Se todos os valores são iguais, linha reta no meio
    const normalise = (v: number) =>
      range === 0 ? 0.5 : (v - min) / range

    const pad = 2
    const w   = width  - pad * 2
    const h   = height - pad * 2

    return values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * w
      const y = pad + (1 - normalise(v)) * h
      return { x, y }
    })
  }, [values, width, height])

  if (!points) return null

  // Direção geral: primeiro vs último
  const first = values[0]
  const last  = values[values.length - 1]
  const isUp  = last > first
  const isFlat = Math.abs(last - first) < (Math.max(...values) - Math.min(...values)) * 0.1

  let lineColor: string
  if (isFlat)              lineColor = '#9ca3af'  // gray-400
  else if (isUp === higherIsBetter) lineColor = '#10b981'  // emerald-500 — tendência boa
  else                     lineColor = '#f43f5e'  // rose-500 — tendência ruim

  // Construir path SVG
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  // Área sombreada abaixo da linha
  const areaD =
    pathD +
    ` L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
    >
      {/* Área sombreada */}
      <path d={areaD} fill={lineColor} fillOpacity={0.08} />
      {/* Linha */}
      <path
        d={pathD}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Ponto final */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={2}
        fill={lineColor}
      />
    </svg>
  )
}
