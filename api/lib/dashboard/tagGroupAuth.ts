import type { SupabaseClient, User } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '../automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from './auth.js'
import { canConfigureTagGroups, canViewTagGroups } from './tagGroupSettings.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TagGroupActor {
  svc: SupabaseClient
  user: User
  companyId: string
  role: string
}

export async function authorizeTagGroups(
  req: any,
  res: any,
  mode: 'view' | 'configure',
): Promise<TagGroupActor | null> {
  const token = extractToken(req.headers?.authorization)
  if (!token) { jsonError(res, 401, 'Não autenticado'); return null }

  const { user, error: authError } = await getUserFromToken(token)
  if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return null }

  const rawCompanyId = mode === 'configure'
    ? req.body?.company_id
    : req.query?.company_id
  const companyId = typeof rawCompanyId === 'string' ? rawCompanyId.trim() : ''
  if (!UUID_RE.test(companyId)) { jsonError(res, 400, 'company_id inválido ou ausente'); return null }

  const svc = getSupabaseAdmin()
  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) { jsonError(res, 403, 'Acesso negado'); return null }

  const allowed = mode === 'configure'
    ? canConfigureTagGroups(membership.role)
    : canViewTagGroups(membership.role)
  if (!allowed) { jsonError(res, 403, 'Permissão insuficiente'); return null }

  return { svc, user, companyId, role: membership.role }
}

export async function resolveTagGroupUserId(
  svc: SupabaseClient,
  res: any,
  companyId: string,
  rawUserId: unknown,
): Promise<string | null | undefined> {
  if (rawUserId == null || rawUserId === '') return null
  if (typeof rawUserId !== 'string' || !UUID_RE.test(rawUserId.trim())) {
    jsonError(res, 400, 'user_id inválido')
    return undefined
  }

  const target = await assertMembership(svc, rawUserId.trim(), companyId)
  if (!target) {
    jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa')
    return undefined
  }

  return rawUserId.trim()
}
