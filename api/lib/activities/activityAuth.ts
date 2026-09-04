// =============================================================================
// api/lib/activities/activityAuth.ts
//
// Helper compartilhado para endpoints de atividades.
// Reutiliza os padrões canônicos do projeto:
//   - getUserFromToken (anon key → auth.getUser())
//   - assertMembership (Trilha 1 + Trilha 2)
//   - getSupabaseAdmin (service_role, somente backend)
//
// SEGURANÇA:
//   - JWT nunca validado com service_role (causa 401 no Supabase JS v2)
//   - company_id nunca confiado sem validação de membership
//   - Toda busca de atividade usa AND company_id = companyId
// =============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractToken, getUserFromToken, assertMembership } from '../dashboard/auth.js'
// @ts-ignore — módulo ESM JS sem types
import { getSupabaseAdmin } from '../automation/supabaseAdmin.js'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_REGEX.test(v)
}

// SELECT utilizado em todos os endpoints de atividade para retornar shape completo
export const ACTIVITY_SELECT = `
  *,
  lead:leads(id, name, phone, email, company_name)
`

// ---------------------------------------------------------------------------
// CallerContext — resultado de uma validação bem-sucedida
// ---------------------------------------------------------------------------

export interface CallerContext {
  userId:    string
  companyId: string
  role:      string
  supabase:  SupabaseClient
}

export type AuthResult =
  | { ok: true;  ctx: CallerContext }
  | { ok: false; status: number; error: string }

// ---------------------------------------------------------------------------
// validateCaller
//
// Valida JWT + membership.
// Usa anon key para JWT (padrão correto — não usar service_role para isso).
// Usa service_role via getSupabaseAdmin() para queries de membership e dados.
//
// @param req      - Vercel request object (precisa de req.headers.authorization)
// @param companyId - company_id recebido do body/query (validado aqui)
// ---------------------------------------------------------------------------

export async function validateCaller(
  req: any,
  companyId: unknown,
): Promise<AuthResult> {
  const token = extractToken(req.headers?.authorization as string | undefined)
  if (!token) {
    return { ok: false, status: 401, error: 'Autenticação necessária' }
  }

  const { user, error: authErr } = await getUserFromToken(token)
  if (authErr || !user) {
    return { ok: false, status: 401, error: 'Sessão inválida ou expirada' }
  }

  if (!isUUID(companyId)) {
    return { ok: false, status: 400, error: 'company_id inválido' }
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabaseAdmin()
  } catch (err: any) {
    console.error('[activityAuth] getSupabaseAdmin falhou:', err?.message)
    return { ok: false, status: 500, error: 'Configuração interna inválida' }
  }

  const membership = await assertMembership(supabase, user.id, companyId as string)
  if (!membership) {
    return { ok: false, status: 403, error: 'Acesso negado à empresa' }
  }

  return {
    ok: true,
    ctx: {
      userId:    user.id,
      companyId: companyId as string,
      role:      membership.role,
      supabase,
    },
  }
}

// ---------------------------------------------------------------------------
// fetchOwnedActivity
//
// Busca atividade garantindo que pertence à empresa.
// NUNCA usa apenas WHERE id = activityId.
// Sempre filtra também por company_id = companyId.
//
// @returns a row with ACTIVITY_SELECT shape, or null if not found/unauthorized
// ---------------------------------------------------------------------------

export async function fetchOwnedActivity(
  activityId: string,
  companyId: string,
  supabase: SupabaseClient,
): Promise<Record<string, any> | null> {
  if (!isUUID(activityId)) return null

  const { data, error } = await supabase
    .from('lead_activities')
    .select(ACTIVITY_SELECT)
    .eq('id', activityId)
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    console.error('[activityAuth] fetchOwnedActivity error:', error.message)
    return null
  }

  return data ?? null
}

// ---------------------------------------------------------------------------
// mapConstraintError
//
// Traduz erros de constraint do Supabase para mensagens user-friendly.
// ---------------------------------------------------------------------------

export function mapConstraintError(msg: string): { status: number; error: string } | null {
  if (msg.includes('valid_scheduled_datetime')) {
    return { status: 422, error: 'A data/hora agendada deve ser no futuro' }
  }
  if (msg.includes('lead_activities_company_id_fkey') || msg.includes('foreign key')) {
    return { status: 400, error: 'Referência inválida (lead ou empresa não encontrados)' }
  }
  return null
}
