// =====================================================
// GET  /api/dashboard/insight-policies
//   Retorna policies mescladas com defaults da empresa.
//
// POST /api/dashboard/insight-policies
//   Salva policies customizadas (requer plano habilitado).
//   Validação de allowlist + limites por campo.
//   Escrita via service_role (RLS bloqueia clients).
//
// Query params: company_id (obrigatório nos dois métodos)
// =====================================================

import { getSupabaseAdmin }       from '../lib/automation/supabaseAdmin.js'
import { extractToken, assertMembership, jsonError } from '../lib/dashboard/auth.js'
import { getInsightPolicies }     from '../lib/dashboard/insightPolicies.js'
import { canCustomizeInsights }   from '../lib/dashboard/insightAccess.js'
import { INSIGHT_DEFAULTS, type InsightPolicyKey } from '../lib/dashboard/insightDefaults.js'

// ---------------------------------------------------------------------------
// Limites de validação por campo (allowlist implícita pelas chaves)
// ---------------------------------------------------------------------------

const POLICY_LIMITS: Record<InsightPolicyKey, { min: number; max: number }> = {
  cooling_threshold_days:    { min: 1,  max: 30 },
  hot_probability_threshold: { min: 50, max: 95 },
  conversion_drop_threshold: { min: 10, max: 80 },
  bottleneck_min_days:       { min: 1,  max: 30 },
  ai_error_rate_threshold:   { min: 5,  max: 80 },
}

const ALLOWED_KEYS = Object.keys(POLICY_LIMITS) as InsightPolicyKey[]

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET' && req.method !== 'POST') {
    jsonError(res, 405, 'Método não permitido')
    return
  }

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
    // 2. company_id + membership ativo
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // GET — retorna policies mescladas com defaults
    // ------------------------------------------------------------------
    if (req.method === 'GET') {
      const policies = await getInsightPolicies(svc, companyId)
      return res.status(200).json({
        ok:       true,
        data:     policies,
        defaults: INSIGHT_DEFAULTS,
      })
    }

    // ------------------------------------------------------------------
    // POST — salva policies (requer plano com feature habilitada)
    // ------------------------------------------------------------------

    // 3. Verificar plano
    const canCustomize = await canCustomizeInsights(svc, companyId)
    if (!canCustomize) {
      jsonError(res, 403, 'Plano não permite customização de regras de insights')
      return
    }

    // 4. Validar payload
    const body = req.body
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      jsonError(res, 400, 'Payload inválido'); return
    }

    const rows: { company_id: string; policy_key: InsightPolicyKey; value: number; updated_at: string }[] = []
    const now = new Date().toISOString()

    for (const key of ALLOWED_KEYS) {
      if (!(key in body)) continue // campo omitido → mantém valor existente

      const raw = (body as Record<string, unknown>)[key]
      const num = typeof raw === 'number' ? raw : Number(raw)

      if (!Number.isFinite(num)) {
        jsonError(res, 400, `Valor inválido para "${key}": deve ser numérico`)
        return
      }

      const { min, max } = POLICY_LIMITS[key]
      if (num < min || num > max) {
        jsonError(res, 400, `Valor fora do intervalo para "${key}": mínimo ${min}, máximo ${max}`)
        return
      }

      rows.push({ company_id: companyId, policy_key: key, value: Math.round(num), updated_at: now })
    }

    if (rows.length === 0) {
      jsonError(res, 400, 'Nenhuma policy válida enviada'); return
    }

    // 5. Upsert via service_role (contorna RLS que bloqueia INSERT/UPDATE de clients)
    const { error: upsertError } = await svc
      .from('ai_insight_policies')
      .upsert(rows, { onConflict: 'company_id,policy_key' })

    if (upsertError) {
      console.error('[dashboard/insight-policies] Erro no upsert:', upsertError.message)
      jsonError(res, 500, 'Erro ao salvar regras'); return
    }

    // 6. Retornar policies atualizadas mescladas com defaults
    const updated = await getInsightPolicies(svc, companyId)
    return res.status(200).json({ ok: true, data: updated })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/insight-policies] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
