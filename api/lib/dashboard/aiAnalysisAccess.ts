// =====================================================
// aiAnalysisAccess
// Helper de controle de acesso para IA Analítica sob demanda.
//
// Responsabilidade:
//   Verifica se a empresa possui a feature flag
//   dashboard_ai_analysis_enabled habilitada no plano.
//
// Regras:
//   - company_type = parent tem acesso irrestrito (padrão do projeto)
//   - demais empresas verificam features.dashboard_ai_analysis_enabled
//   - feature flag é controle administrativo, não comercial
//   - saldo de créditos é a barreira real de uso (verificado no endpoint)
//
// Nunca lança exceção — retorna false em caso de falha.
// =====================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getPlanLimits } from '../plans/limitChecker.js'

/**
 * Retorna true se a empresa possui a feature flag de IA Analítica habilitada.
 * Falha silenciosa: erro na consulta retorna false (acesso negado por padrão).
 */
export async function canAiAnalysis(
  svc: SupabaseClient,
  companyId: string,
): Promise<boolean> {
  if (!companyId) return false

  try {
    // Empresa pai tem acesso irrestrito a features de análise
    const { data: company } = await svc
      .from('companies')
      .select('company_type')
      .eq('id', companyId)
      .maybeSingle()

    if (company?.company_type === 'parent') return true

    const limits = await getPlanLimits(svc, companyId)
    return limits.features?.['dashboard_ai_analysis_enabled'] === true
  } catch {
    return false
  }
}
