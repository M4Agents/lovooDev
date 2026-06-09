// =====================================================
// POST /api/internal/snapshot-fallback-log
//
// Registra fallbacks silenciosos do frontend na tabela
// dashboard_snapshot_fallback_logs.
//
// Fire-and-forget: o frontend não espera nem trata erros deste endpoint.
// NÃO bloqueia UX em hipótese alguma.
//
// Body JSON:
//   company_id  string (obrigatório)
//   endpoint    'comparison' | 'trends' | 'seller-deltas'
//   reason      'missing_data' | 'api_error' | 'insufficient_points' | 'freshness_stale'
//   mode        'wow' | 'mom' | null (opcional)
//
// Autenticação: Bearer JWT do usuário (valida membership).
// Inserção: service_role (service_role bypassa RLS).
// Sem PII no payload.
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
}                           from '../lib/dashboard/auth.js'

const VALID_ENDPOINTS = new Set([
  // FASE 4.1 — endpoints legados (frontend fire-and-forget)
  'comparison',
  'trends',
  'seller-deltas',
  // FASE 4.2 — endpoints v2 (backend logHistoricalFallback)
  'executive-summary-v2',
  'seller-ranking-v2',
  'sla-alerts-v2',
  'forecast-v2',
  'funnel-executive-v2',
])

const VALID_REASONS = new Set([
  // FASE 4.1 — motivos legados
  'missing_data',
  'api_error',
  'insufficient_points',
  'freshness_stale',
  // FASE 4.2 — motivos dos endpoints v2
  'aggregate_failed',
  'cache_empty',
  'no_snapshot_data',
])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST')    { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // ── Autenticação ─────────────────────────────────────────────────────────
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc  = getSupabaseAdmin()
    const body = req.body ?? {}

    const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : ''
    const endpoint  = typeof body.endpoint   === 'string' ? body.endpoint.trim()   : ''
    const reason    = typeof body.reason     === 'string' ? body.reason.trim()     : ''
    const mode      = typeof body.mode       === 'string' ? body.mode.trim()       : null

    // Validação de presença
    if (!companyId) { jsonError(res, 400, 'company_id obrigatório'); return }
    if (!endpoint)  { jsonError(res, 400, 'endpoint obrigatório'); return }
    if (!reason)    { jsonError(res, 400, 'reason obrigatório'); return }

    // Whitelist de valores (sem injeção de valores arbitrários)
    if (!VALID_ENDPOINTS.has(endpoint)) { jsonError(res, 400, 'endpoint inválido'); return }
    if (!VALID_REASONS.has(reason))     { jsonError(res, 400, 'reason inválido'); return }

    // Validação de membership (usuário precisa ser membro ativo da empresa)
    const member = await assertMembership(svc, user.id, companyId)
    if (!member) { jsonError(res, 403, 'Acesso negado'); return }

    // ── Inserir log (service_role, sem RLS) ───────────────────────────────────
    const { error: insertError } = await svc
      .from('dashboard_snapshot_fallback_logs')
      .insert({
        company_id:  companyId,
        endpoint,
        reason,
        mode:        mode || null,
        occurred_at: new Date().toISOString(),
      })

    if (insertError) {
      // Não expor erro interno ao frontend — é fire-and-forget
      console.error('[snapshot-fallback-log] Insert error:', insertError.message)
    }

    // Sempre retornar 200 para não quebrar UX
    return res.status(200).json({ ok: true })
  } catch (err: any) {
    // Nunca propagar erro ao frontend
    console.error('[snapshot-fallback-log] Erro silencioso:', err?.message)
    return res.status(200).json({ ok: true })
  }
}
