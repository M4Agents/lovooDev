// =====================================================
// GET /api/dashboard/funnels
//
// Retorna lista de funis ativos da empresa para
// alimentar o seletor de funil no dashboard.
//
// Query params:
//   company_id  (obrigatório)
//
// Segurança:
//   - company_id validado contra membership real do usuário autenticado
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET') { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ------------------------------------------------------------------
    // 1. Autenticação
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // ------------------------------------------------------------------
    // 2. Validação de company_id + membership
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. Consulta de funis ativos
    // ------------------------------------------------------------------
    const { data, error } = await svc
      .from('sales_funnels')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('name')

    if (error) {
      console.error('[dashboard/funnels] Erro na query:', error.message)
      jsonError(res, 500, 'Erro ao buscar funis')
      return
    }

    // ------------------------------------------------------------------
    // 4. Resposta com cache longo (funis mudam raramente)
    // ------------------------------------------------------------------
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')

    return res.status(200).json({
      data: data ?? [],
      meta: {},
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/funnels] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
