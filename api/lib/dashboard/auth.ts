import type { SupabaseClient } from '@supabase/supabase-js'

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
// jsonError — helper de resposta de erro padronizada
// ---------------------------------------------------------------------------

export function jsonError(
  res: { status: (code: number) => { json: (body: unknown) => void } },
  status: number,
  error: string,
): void {
  res.status(status).json({ ok: false, error })
}
