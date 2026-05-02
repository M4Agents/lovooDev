// =====================================================
// insightPolicies
// Helper para buscar e mesclar políticas de insights por empresa.
//
// Comportamento:
//   1. Busca policies da empresa em ai_insight_policies
//   2. Mescla com INSIGHT_DEFAULTS (policy existente tem precedência)
//   3. Sempre retorna objeto completo — nunca null/undefined
//
// Falha silenciosa: se a tabela não existir ou a query falhar,
// retorna os defaults sem lançar exceção.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { INSIGHT_DEFAULTS, type InsightPolicyKey } from './insightDefaults.js'

export type InsightPolicies = typeof INSIGHT_DEFAULTS

/**
 * Retorna as políticas de insight da empresa, mescladas com os defaults.
 * Nunca lança exceção — falha silenciosa retorna defaults.
 */
export async function getInsightPolicies(
  svc: SupabaseClient,
  companyId: string,
): Promise<InsightPolicies> {
  if (!companyId) return { ...INSIGHT_DEFAULTS }

  try {
    const { data, error } = await svc
      .from('ai_insight_policies')
      .select('policy_key, value')
      .eq('company_id', companyId)

    if (error || !data) return { ...INSIGHT_DEFAULTS }

    // Mesclar: policy da empresa sobrescreve default
    const overrides = Object.fromEntries(
      data
        .filter((row: { policy_key: string; value: number }) =>
          Object.prototype.hasOwnProperty.call(INSIGHT_DEFAULTS, row.policy_key),
        )
        .map((row: { policy_key: string; value: number }) => [row.policy_key, Number(row.value)]),
    ) as Partial<InsightPolicies>

    return {
      ...INSIGHT_DEFAULTS,
      ...overrides,
    } as InsightPolicies

  } catch {
    // Tabela pode não existir em ambientes antigos — fallback seguro
    return { ...INSIGHT_DEFAULTS }
  }
}
