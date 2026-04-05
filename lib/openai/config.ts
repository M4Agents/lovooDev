// =====================================================
// Configuração central OpenAI (server-side apenas)
// OPENAI_API_KEY só em process.env
// Modelo e timeout operacionais vêm de integration_settings (lib/openai/settingsDb.ts)
// =====================================================

/** Empresa Pai (M4): única que pode gerenciar a integração na UI/API de gestão. */
export const PARENT_COMPANY_ID = 'd4d46c98-17da-4d0b-9b1f-6d947c34f146'

/**
 * Roles permitidos para gerenciar a integração OpenAI.
 * Alinhado a `UserRole` em src/types/user.ts (`super_admin`, `admin`).
 */
export const MANAGE_OPENAI_INTEGRATION_ROLES = ['super_admin', 'admin'] as const

export type ManageOpenAIIntegrationRole = (typeof MANAGE_OPENAI_INTEGRATION_ROLES)[number]

export function isManageOpenAIIntegrationRole(role: string): role is ManageOpenAIIntegrationRole {
  return (MANAGE_OPENAI_INTEGRATION_ROLES as readonly string[]).includes(role)
}

export function getSupabasePublicEnv(): { url: string; anonKey: string } | null {
  const url = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url || !anonKey) return null
  return { url, anonKey }
}

export function isOpenAIApiKeyConfigured(): boolean {
  const k = process.env.OPENAI_API_KEY
  return typeof k === 'string' && k.trim().length > 0
}

/** Timeout máximo do cliente HTTP SDK (requisições usam signal por config da tabela). */
export const OPENAI_CLIENT_MAX_TIMEOUT_MS = 120_000
