// =====================================================
// insightAccess
// Helper de controle de acesso para customização de insights.
//
// Responsabilidade:
//   Verifica se a empresa possui a feature flag
//   dashboard_insight_customization_enabled habilitada no plano.
//
// Nunca lança exceção — retorna false em caso de falha.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlanLimits } from '../plans/limitChecker.js'

/**
 * Retorna true se o plano da empresa permite customização de regras de insights.
 * Falha silenciosa: erro na consulta de plano retorna false (acesso negado).
 */
export async function canCustomizeInsights(
  svc: SupabaseClient,
  companyId: string,
): Promise<boolean> {
  if (!companyId) return false

  try {
    // Empresa pai tem acesso irrestrito a features de configuração
    const { data: company } = await svc
      .from('companies')
      .select('company_type')
      .eq('id', companyId)
      .maybeSingle()

    if (company?.company_type === 'parent') return true

    const limits = await getPlanLimits(svc, companyId)
    return limits.features?.['dashboard_insight_customization_enabled'] === true
  } catch {
    return false
  }
}
