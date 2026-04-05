// =====================================================
// Visibilidade da integração OpenAI no frontend.
// Deve refletir lib/openai/config.ts (PARENT_COMPANY_ID) e roles de gestão.
// A segurança real permanece no backend.
// =====================================================

import type { Company } from '../lib/supabase'
import type { UserRole } from '../types/user'

/** Mesmo UUID que lib/openai/config.ts — empresa Pai (M4). Critério oficial de visibilidade na UI. */
export const PARENT_COMPANY_ID_OPENAI = 'd4d46c98-17da-4d0b-9b1f-6d947c34f146'

/**
 * Visibilidade da integração OpenAI no frontend: sessão na empresa Pai (id fixo) + papel de gestão.
 * Não usa `company_type`: o backend autoriza por membership em `company_users` na empresa Pai (`lib/openai/auth.ts`).
 */
export function canManageOpenAIIntegration(
  company: Company | null | undefined,
  currentRole: UserRole | null | undefined
): boolean {
  if (!company || !currentRole) return false
  if (company.id !== PARENT_COMPANY_ID_OPENAI) return false
  return currentRole === 'super_admin' || currentRole === 'admin'
}
