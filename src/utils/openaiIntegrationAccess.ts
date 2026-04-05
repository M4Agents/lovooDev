// =====================================================
// Visibilidade da integração OpenAI no frontend.
// Deve refletir lib/openai/config.ts (PARENT_COMPANY_ID) e roles de gestão.
// A segurança real permanece no backend.
// =====================================================

import type { Company } from '../lib/supabase'
import type { UserRole } from '../types/user'
import { PARENT_COMPANY_ID } from '../config/parentCompanyId'

/** Alias — visibilidade OpenAI na UI (mesmo UUID que lib/openai/config no servidor). */
export const PARENT_COMPANY_ID_OPENAI = PARENT_COMPANY_ID

/**
 * Visibilidade da integração OpenAI no frontend: sessão na empresa Pai (id fixo) + papel de gestão
 * ou super admin legado (`companies.is_super_admin`), alinhado ao `lib/openai/auth.ts`.
 */
export function canManageOpenAIIntegration(
  company: Company | null | undefined,
  currentRole: UserRole | null | undefined
): boolean {
  if (!company) return false
  if (company.id !== PARENT_COMPANY_ID_OPENAI) return false

  if (company.is_super_admin === true) return true

  if (!currentRole) return false
  return currentRole === 'super_admin' || currentRole === 'admin'
}
