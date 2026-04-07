// =====================================================
// Autorização — gestão da integração OpenAI (empresa Pai)
// Usa Supabase anon + JWT do usuário (sem service_role).
// Valida membership em company_users via RLS.
// =====================================================

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getSupabasePublicEnv,
  PARENT_COMPANY_ID,
  isManageOpenAIIntegrationRole,
} from './config.js'

export type ManageOpenAIAuthSuccess = {
  ok: true
  userId: string
  role: string
  supabase: SupabaseClient
}

export type ManageOpenAIAuthFailure = {
  ok: false
  status: 401 | 403
  message: string
}

export type ManageOpenAIAuthResult = ManageOpenAIAuthSuccess | ManageOpenAIAuthFailure

/** Request mínimo (Vercel / Node). */
export type OpenAIRequestLike = {
  headers?: Record<string, string | string[] | undefined>
  body?: unknown
}

function getAuthorizationHeader(req: OpenAIRequestLike): string | undefined {
  const raw = req.headers?.authorization
  if (Array.isArray(raw)) return raw[0]
  return raw
}

/**
 * Garante: usuário autenticado e vínculo admin/super_admin em company_users na empresa Pai.
 */
export async function assertCanManageOpenAIIntegration(
  req: OpenAIRequestLike
): Promise<ManageOpenAIAuthResult> {
  const env = getSupabasePublicEnv()
  if (!env) {
    return { ok: false, status: 403, message: 'Supabase não configurado no servidor' }
  }

  const authorization = getAuthorizationHeader(req)
  if (!authorization || !authorization.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Autenticação necessária' }
  }

  const supabase = createClient(env.url, env.anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()

  if (authErr || !user) {
    return { ok: false, status: 401, message: 'Sessão inválida ou expirada' }
  }

  const { data: membership, error: membershipErr } = await supabase
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', PARENT_COMPANY_ID)
    .maybeSingle()

  const role = membership?.role
  if (role && isManageOpenAIIntegrationRole(role)) {
    return { ok: true, userId: user.id, role, supabase }
  }

  if (membershipErr) {
    return { ok: false, status: 403, message: 'Acesso negado' }
  }

  if (!role) {
    return { ok: false, status: 403, message: 'Acesso restrito à empresa matriz' }
  }

  return { ok: false, status: 403, message: 'Permissão insuficiente' }
}
