import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'

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

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2d444'},body:JSON.stringify({sessionId:'e2d444',location:'auth.ts:assertMembership:trail1',message:'Trilha 1 result',data:{userId,companyId,found:!!direct,role:direct?.role??null},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
  // #endregion

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

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2d444'},body:JSON.stringify({sessionId:'e2d444',location:'auth.ts:assertMembership:trail2_parent',message:'Trilha 2 parent lookup',data:{companyId,parentCompanyId:company?.parent_company_id??null},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (!company?.parent_company_id) return null

  const { data: parentMember } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', company.parent_company_id)
    .eq('is_active', true)
    .in('role', ['super_admin', 'system_admin'])
    .maybeSingle()

  // #region agent log
  fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'e2d444'},body:JSON.stringify({sessionId:'e2d444',location:'auth.ts:assertMembership:trail2_result',message:'Trilha 2 result',data:{userId,parentCompanyId:company.parent_company_id,found:!!parentMember,role:parentMember?.role??null},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
  // #endregion

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
