// =============================================================================
// api/lib/notifications/auth.js
//
// Helper de autenticação para os endpoints admin de notificações.
//
// Padrão: mesma abordagem de api/lib/openai/auth.ts —
//   cliente anon + JWT do usuário (sem service_role).
//   RLS do Supabase valida o acesso às tabelas notification_templates
//   e integration_settings.
//
// Autorização exigida: super_admin OU system_admin na empresa pai (PARENT_COMPANY_ID).
// Usuário inativo (is_active = false) é tratado como sem acesso.
// Empresa pai: somente usuários com membership ativa no PARENT_COMPANY_ID.
//
// Uso: chamado pelos endpoints admin de notificações (GET/PUT settings, GET/PUT templates).
// Nunca importar no frontend.
// =============================================================================

import { createClient } from '@supabase/supabase-js'

// ── Constantes ─────────────────────────────────────────────────────────────────

const DEFAULT_PARENT_COMPANY_ID = 'dcc99d3d-9def-4b93-aeb2-1a3be5f15413'

export const PARENT_COMPANY_ID =
  (typeof process.env?.PARENT_COMPANY_ID === 'string' && process.env.PARENT_COMPANY_ID.trim()
    ? process.env.PARENT_COMPANY_ID.trim()
    : DEFAULT_PARENT_COMPANY_ID)

/** Roles autorizados a gerenciar notificações da plataforma. */
const PLATFORM_ADMIN_ROLES = ['super_admin', 'system_admin']

// ── Helpers internos ───────────────────────────────────────────────────────────

function getEnvs() {
  const url     = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  if (!url.trim() || !anonKey.trim()) return null
  return { url, anonKey }
}

function extractBearerToken(req) {
  const raw = req.headers?.authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  return header.slice(7)
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * @typedef {{ ok: true, supabase: import('@supabase/supabase-js').SupabaseClient, userId: string, role: string }} NotifAuthSuccess
 * @typedef {{ ok: false, status: 401|403|500, error: string }} NotifAuthFailure
 * @typedef {NotifAuthSuccess | NotifAuthFailure} NotifAuthResult
 */

/**
 * Valida se o usuário autenticado é super_admin ou system_admin da empresa pai.
 *
 * Retorna um cliente Supabase com o JWT do usuário injetado para que
 * as operações subsequentes sejam executadas no contexto do usuário
 * (beneficiando-se da RLS das tabelas notification_templates e integration_settings).
 *
 * @param {object} req - Vercel request
 * @returns {Promise<NotifAuthResult>}
 */
export async function assertNotificationsAdmin(req) {
  const envs = getEnvs()
  if (!envs) {
    return { ok: false, status: 500, error: 'Configuração do servidor incompleta' }
  }

  const token = extractBearerToken(req)
  if (!token) {
    return { ok: false, status: 401, error: 'Token de autenticação necessário' }
  }

  // Cliente com JWT do usuário — RLS ativa, auth.uid() funciona
  const supabase = createClient(envs.url, envs.anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  // Validar JWT
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' }
  }

  // Verificar membership ativa na empresa pai com role autorizado
  const { data: membership, error: memberErr } = await supabase
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', PARENT_COMPANY_ID)
    .eq('is_active', true)
    .maybeSingle()

  if (memberErr) {
    return { ok: false, status: 500, error: 'Erro ao validar permissões' }
  }

  if (!membership) {
    return { ok: false, status: 403, error: 'Acesso restrito à empresa matriz' }
  }

  if (!PLATFORM_ADMIN_ROLES.includes(membership.role)) {
    return { ok: false, status: 403, error: 'Permissão insuficiente. Requer super_admin ou system_admin' }
  }

  return { ok: true, supabase, userId: user.id, role: membership.role }
}
