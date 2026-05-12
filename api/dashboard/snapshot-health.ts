// =====================================================
// GET /api/dashboard/snapshot-health
//
// Retorna o health score consolidado da camada histórica de snapshots
// para um tenant, baseado em: freshness, drift, cobertura e cron reliability.
//
// Usado para:
//   - Monitoramento operacional da camada histórica
//   - Critério de readiness para FASE 4.2 (dual-read)
//   - Fallback decision support no SnapshotDataGuard
//
// Query params:
//   company_id  (obrigatório)
//   date        (opcional — YYYY-MM-DD; padrão: hoje)
//
// Autenticação: Bearer JWT do usuário → membership validado.
// Cálculo: RPC get_snapshot_health_score (SECURITY DEFINER, service_role).
// =====================================================

import { getSupabaseAdmin }   from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
}                              from '../lib/dashboard/auth.js'
import { withTiming }          from '../lib/dashboard/observability.js'

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ── Autenticação ─────────────────────────────────────────────────────────
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc       = getSupabaseAdmin()
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id obrigatório'); return }

    const member = await assertMembership(svc, user.id, companyId)
    if (!member) { jsonError(res, 403, 'Acesso negado'); return }

    // ── Data de referência ────────────────────────────────────────────────────
    let refDate: string
    if (
      typeof req.query.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ) {
      refDate = req.query.date
    } else {
      refDate = new Date().toISOString().slice(0, 10)
    }

    // ── Calcular health score via RPC ─────────────────────────────────────────
    const result = await withTiming(
      'snapshot.health_score',
      async () => {
        const { data, error } = await svc.rpc('get_snapshot_health_score', {
          p_company_id:     companyId,
          p_reference_date: refDate,
        })

        if (error) throw new Error(error.message)
        if (!data) throw new Error('RPC retornou vazio')

        return data
      },
      { companyId },
    )

    return res.status(200).json({
      ok:   true,
      ...result,
    })
  } catch (err: any) {
    console.error('[snapshot-health] Erro:', err?.message)
    jsonError(res, 500, 'Erro ao calcular health score')
  }
}
