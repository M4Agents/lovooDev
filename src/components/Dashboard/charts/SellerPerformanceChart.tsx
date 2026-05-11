// SellerPerformanceChart
// Visualização horizontal de score por vendedor usando barras CSS.
// Não usa Recharts — mais leve e adequado para dados de ranking.

import React from 'react'
import type { SellerRankingEntry } from '../../../types/dashboard'

interface Props {
  data: SellerRankingEntry[]
}

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500'
  if (score >= 45) return 'bg-amber-400'
  return 'bg-rose-500'
}

function scoreLabel(score: number): string {
  if (score >= 70) return 'text-emerald-600'
  if (score >= 45) return 'text-amber-600'
  return 'text-rose-600'
}

export function SellerPerformanceChart({ data }: Props) {
  if (data.length === 0) return null

  // Apenas sellers com score real (team view)
  const ranked = data.filter(s => s.score !== null)
  if (ranked.length === 0) return null

  const maxScore = Math.max(...ranked.map(s => s.score as number))

  return (
    <div className="space-y-3">
      {ranked.map(seller => {
        const score    = seller.score as number
        const barWidth = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0

        return (
          <div key={seller.user_id} className="flex items-center gap-3">
            {/* Rank badge */}
            {seller.rank !== null && (
              <span className="w-6 text-right text-xs font-semibold text-zinc-400 shrink-0">
                #{seller.rank}
              </span>
            )}

            {/* Nome */}
            <span className="w-28 text-xs font-medium text-zinc-700 dark:text-zinc-200 truncate shrink-0">
              {seller.display_name}
            </span>

            {/* Barra */}
            <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${scoreColor(score)}`}
                style={{ width: `${barWidth}%` }}
              />
            </div>

            {/* Score */}
            <span className={`w-10 text-right text-xs font-bold shrink-0 ${scoreLabel(score)}`}>
              {score.toFixed(0)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
