// =====================================================
// Visibilidade das integrações SaaS (OpenAI, ElevenLabs, Agentes) no frontend.
// Regra: usuário super_admin na empresa pai (company_type = 'parent').
// A segurança real permanece no backend (api/lib/openai/auth.ts).
// =====================================================

import type { Company } from '../lib/supabase'
import type { UserRole } from '../types/user'

/**
 * Verifica se o usuário pode gerenciar integrações SaaS (OpenAI, ElevenLabs, Agentes).
 *
 * Regra: super_admin ativo na empresa pai.
 * - company.company_type === 'parent'  → garante que é a empresa da plataforma
 * - currentRole === 'super_admin'      → garante privilégio de gestão
 *
 * Não depende de UUID hardcoded para ser robusto em qualquer ambiente.
 */
export function canManageOpenAIIntegration(
  company: Company | null | undefined,
  currentRole: UserRole | null | undefined
): boolean {
  if (!company) return false
  if (company.company_type !== 'parent') return false
  if (!currentRole) return false
  return currentRole === 'super_admin'
}

/**
 * Alias semântico explícito para gates de telas SaaS.
 * Usa a mesma regra de canManageOpenAIIntegration.
 */
export function isSaaSAdmin(
  company: Company | null | undefined,
  currentRole: UserRole | null | undefined
): boolean {
  return canManageOpenAIIntegration(company, currentRole)
}
