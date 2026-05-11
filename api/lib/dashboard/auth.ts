import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// assertMembership
// ---------------------------------------------------------------------------

/**
 * Valida que o usuário autenticado é membro ativo da empresa solicitada.
 * Retorna o role do membro para uso posterior (ex: verificação de permissão).
 *
 * Usa o service_role client (svc) para evitar dependência de RLS na consulta
 * de membership — o próprio filtro user_id + company_id + is_active é a barreira.
 */
export async function assertMembership(
  svc: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<{ role: string } | null> {
  const { data } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', userId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()

  return data ?? null
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
