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
  getUserFromToken,
  assertMembership,
  assertUserFunnelAccess,
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

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }
    const svc = getSupabaseAdmin()

    // ------------------------------------------------------------------
    // 2. Validação de company_id + membership
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. Verificar restrições pessoais de funis (Fase 2)
    // ------------------------------------------------------------------
    const funnelAccess = await assertUserFunnelAccess({
      svc, userId: user.id, companyId, role: membership.role, funnelId: null,
    })
    if (!funnelAccess.ok) { jsonError(res, funnelAccess.status, funnelAccess.error); return }

    // ------------------------------------------------------------------
    // 4. Consulta de funis ativos (filtrada quando usuário restrito)
    // ------------------------------------------------------------------
    let query = svc
      .from('sales_funnels')
      .select('id, name, is_default')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('name')

    if (funnelAccess.allowedFunnelIds !== null) {
      query = query.in('id', funnelAccess.allowedFunnelIds)
    }

    const { data, error } = await query

    if (error) {
      console.error('[dashboard/funnels] Erro na query:', error.message)
      jsonError(res, 500, 'Erro ao buscar funis')
      return
    }

    // ------------------------------------------------------------------
    // 5. Resposta (sem cache quando usuário está restrito — lista personalizada)
    // ------------------------------------------------------------------
    // Usuários restritos recebem lista personalizada — não cachear no CDN
    if (funnelAccess.allowedFunnelIds !== null) {
      res.setHeader('Cache-Control', 'no-store')
    } else {
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
    }

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
