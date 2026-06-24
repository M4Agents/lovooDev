import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// assertUserFunnelAccess — Fase 2: restrições de funis por usuário
// ---------------------------------------------------------------------------

/**
 * Roles que NUNCA sofrem restrição por user_funnel_settings.
 *
 * - admin / super_admin / system_admin: acesso irrestrito a todos os funis.
 * - partner: confia na validação já realizada por assertMembership
 *   (partner_company_assignments). Não criar lógica adicional aqui.
 */
const FUNNEL_UNRESTRICTED_ROLES = new Set([
  'admin', 'super_admin', 'system_admin', 'partner',
])

/**
 * Resultado da verificação de acesso a funis.
 *
 * { ok: true,  allowedFunnelIds: null }      → sem restrição (acesso total)
 * { ok: true,  allowedFunnelIds: string[] }  → restrito; lista de IDs permitidos
 * { ok: false, status: 403 | 500, error }    → acesso negado ou erro interno
 *
 * IMPORTANTE: erros internos de BD retornam { ok: false, status: 500 }.
 * Apenas estados de negócio explícitos (sem registro / disabled / lista vazia)
 * liberam acesso. Não há fail-open para erros.
 */
export type FunnelAccessResult =
  | { ok: true;  allowedFunnelIds: null }
  | { ok: true;  allowedFunnelIds: string[] }
  | { ok: false; status: 403 | 500; error: string }

/**
 * Verifica se o usuário tem permissão de acesso ao funil solicitado.
 *
 * Consultas realizadas (service_role — bypass de RLS):
 *   1. user_funnel_settings  (company_id + user_id) — sempre
 *   2. user_allowed_funnels  (company_id + user_id) — apenas quando is_enabled = true
 *
 * Regras de negócio:
 *   - Sem registro em user_funnel_settings    → acesso total
 *   - is_enabled = false                      → acesso total
 *   - is_enabled = true + lista vazia         → acesso total
 *   - is_enabled = true + lista de funis      → restrito à lista
 *
 * @param funnelId  UUID do funil solicitado, ou null para "todos os funis".
 *                  Quando null, retorna { allowedFunnelIds } para uso pelo caller
 *                  (ex.: filtrar listagem ou exigir seleção explícita).
 */
export async function assertUserFunnelAccess(params: {
  svc:       SupabaseClient
  userId:    string
  companyId: string
  role:      string
  funnelId:  string | null
}): Promise<FunnelAccessResult> {
  const { svc, userId, companyId, role, funnelId } = params

  // ── Bypass imediato para roles irrestritos ─────────────────────────────────
  if (FUNNEL_UNRESTRICTED_ROLES.has(role)) {
    return { ok: true, allowedFunnelIds: null }
  }

  // ── Consultar user_funnel_settings (company_id + user_id) ─────────────────
  const { data: settings, error: settingsError } = await svc
    .from('user_funnel_settings')
    .select('is_enabled')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .maybeSingle()

  if (settingsError) {
    console.error('[assertUserFunnelAccess] Erro em user_funnel_settings:', settingsError.message)
    return { ok: false, status: 500, error: 'Erro interno ao verificar permissões de funis.' }
  }

  // Sem registro ou is_enabled = false → acesso total
  if (!settings || !settings.is_enabled) {
    return { ok: true, allowedFunnelIds: null }
  }

  // ── Consultar user_allowed_funnels (company_id + user_id) ─────────────────
  const { data: allowedRows, error: allowedError } = await svc
    .from('user_allowed_funnels')
    .select('funnel_id')
    .eq('company_id', companyId)
    .eq('user_id', userId)

  if (allowedError) {
    console.error('[assertUserFunnelAccess] Erro em user_allowed_funnels:', allowedError.message)
    return { ok: false, status: 500, error: 'Erro interno ao verificar funis permitidos.' }
  }

  const allowedFunnelIds = (allowedRows ?? []).map(r => r.funnel_id as string)

  // is_enabled = true + lista vazia → acesso total
  if (allowedFunnelIds.length === 0) {
    return { ok: true, allowedFunnelIds: null }
  }

  // ── Validar funnelId específico (quando fornecido) ─────────────────────────
  if (funnelId !== null && !allowedFunnelIds.includes(funnelId)) {
    return { ok: false, status: 403, error: 'Acesso negado: funil não autorizado para este usuário.' }
  }

  // Restrito com lista válida (funnelId null ou funnelId permitido)
  return { ok: true, allowedFunnelIds }
}

// ---------------------------------------------------------------------------
// assertMembership
// ---------------------------------------------------------------------------

/**
 * Valida que o usuário autenticado é membro ativo da empresa solicitada.
 * Retorna o role do membro para uso posterior (ex: verificação de permissão).
 *
 * Trilha 1: membership direto em company_users (qualquer role ativo).
 * Trilha 2: super_admin / system_admin ativo na empresa PAI da empresa solicitada.
 *           Espelha auth_user_is_parent_admin() do banco — mesmos critérios.
 *
 * Usa o service_role client (svc) para evitar dependência de RLS na consulta
 * de membership — o próprio filtro user_id + company_id + is_active é a barreira.
 */
export async function assertMembership(
  svc: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<{ role: string } | null> {
  // ── Trilha 1: membership direto ──────────────────────────────────────────
  const { data: direct } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()

  if (direct) return direct

  // ── Trilha 2: super_admin / system_admin da empresa pai ──────────────────
  // Espelha exatamente auth_user_is_parent_admin() do banco:
  //   1. empresa alvo deve ter parent_company_id
  //   2. usuário deve ser super_admin ou system_admin ativo nessa empresa pai
  const { data: company } = await svc
    .from('companies')
    .select('parent_company_id')
    .eq('id', companyId)
    .maybeSingle()

  if (!company?.parent_company_id) return null

  const { data: parentMember } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', company.parent_company_id)
    .eq('is_active', true)
    .in('role', ['super_admin', 'system_admin'])
    .maybeSingle()

  return parentMember ?? null
}

// ---------------------------------------------------------------------------
// assertFunnelBelongsToCompany
// ---------------------------------------------------------------------------

/**
 * Valida que o funnel_id pertence à empresa.
 * Nunca confiar no funnel_id enviado pelo frontend sem esta validação.
 */
export async function assertFunnelBelongsToCompany(
  svc: SupabaseClient,
  funnelId: string,
  companyId: string,
): Promise<boolean> {
  const { data } = await svc
    .from('sales_funnels')
    .select('id')
    .eq('id', funnelId)
    .eq('company_id', companyId)
    .maybeSingle()

  return !!data
}

// ---------------------------------------------------------------------------
// extractToken
// ---------------------------------------------------------------------------

/**
 * Extrai o Bearer token do header Authorization.
 * Retorna null se ausente ou malformado.
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7).trim()
  return token.length > 0 ? token : null
}

// ---------------------------------------------------------------------------
// getUserFromToken
// ---------------------------------------------------------------------------

/**
 * Valida o JWT do usuário usando o padrão correto do projeto:
 * cliente anon key + Authorization header global → auth.getUser() sem parâmetro.
 *
 * NÃO usar service_role para validar JWT de usuário — causa 401 no Supabase JS v2.
 * O service_role é obtido separadamente via getSupabaseAdmin() para queries admin.
 */
export async function getUserFromToken(
  token: string,
): Promise<{ user: User | null; error: Error | null }> {
  const url  = process.env.VITE_SUPABASE_URL ?? ''
  const anon =
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    ''

  if (!url || !anon) {
    return { user: null, error: new Error('Configuração de servidor incompleta') }
  }

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user }, error } = await caller.auth.getUser()
  return { user: user ?? null, error: error ?? null }
}

// ---------------------------------------------------------------------------
// jsonError — helper de resposta de erro padronizada
// ---------------------------------------------------------------------------

export function jsonError(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  status: number,
  error: string,
): void {
  res.status(status).json({ ok: false, error })
}
