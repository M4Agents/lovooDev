// =====================================================
// Visibilidade da integração OpenAI no frontend.
// Deve refletir api/lib/openai/config.ts (PARENT_COMPANY_ID) e roles de gestão.
// A segurança real permanece no backend.
// =====================================================

import type { Company } from '../lib/supabase'
import type { UserRole } from '../types/user'
import { PARENT_COMPANY_ID } from '../config/parentCompanyId'

/** Alias — visibilidade OpenAI na UI (mesmo UUID que api/lib/openai/config no servidor). */
export const PARENT_COMPANY_ID_OPENAI = PARENT_COMPANY_ID

/**
 * Visibilidade da integração OpenAI no frontend: sessão na empresa Pai (id fixo) + papel de gestão.
 * Alinhado ao `api/lib/openai/auth.ts` (usa company_users.role, sem legado is_super_admin).
 */
export function canManageOpenAIIntegration(
  company: Company | null | undefined,
  currentRole: UserRole | null | undefined
): boolean {
  if (!company) return false
  if (company.id !== PARENT_COMPANY_ID_OPENAI) return false
  if (!currentRole) return false
  return currentRole === 'super_admin' || currentRole === 'admin'
}
