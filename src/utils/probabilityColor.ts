/** Escala já usada no Dashboard: ≥70 alto, ≥40 médio, abaixo baixo. */
export type ProbabilityTone = 'high' | 'medium' | 'low'

export function getProbabilityTone(probability: number): ProbabilityTone {
  if (probability >= 70) return 'high'
  if (probability >= 40) return 'medium'
  return 'low'
}

export function getProbabilityTextClass(probability: number): string {
  const tone = getProbabilityTone(probability)
  if (tone === 'high') return 'text-green-600'
  if (tone === 'medium') return 'text-yellow-600'
  return 'text-red-500'
}

export function getProbabilityBadgeClass(probability: number): string {
  const tone = getProbabilityTone(probability)
  if (tone === 'high') return 'bg-green-100 text-green-700'
  if (tone === 'medium') return 'bg-yellow-100 text-yellow-700'
  return 'bg-red-100 text-red-700'
}
