// =====================================================
// GET /api/dashboard/ai-analysis/[id]
//
// Carrega uma análise específica sem chamar LLM.
//
// Comportamento por status:
//   completed       → retorna output completo
//   credit_failed   → NÃO retorna output; retorna metadata + créditos necessários
//   awaiting_credits → retorna dados para continuação da compra
//   processing      → retorna status atual
//   pending|failed  → retorna status + error_message
//
// Segurança:
//   - Auth obrigatório
//   - Membership validado contra company_id da análise
//   - output NUNCA exposto quando status = credit_failed
// =====================================================

import { getSupabaseAdmin }    from '../../lib/automation/supabaseAdmin.js'
import { extractToken, assertMembership, jsonError } from '../../lib/dashboard/auth.js'

const MARGIN_FACTOR = 1.3

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // 1. Auth
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const svc = getSupabaseAdmin()
    const { data: { user }, error: authError } = await svc.auth.getUser(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    // 2. ID da rota
    const analysisId = typeof req.query.id === 'string' ? req.query.id.trim() : ''
    if (!analysisId) { jsonError(res, 400, 'id é obrigatório'); return }

    // 3. Buscar análise
    const { data: analysis, error: fetchErr } = await svc
      .from('dashboard_ai_analyses')
      .select([
        'id', 'company_id', 'user_id', 'analysis_type', 'funnel_id', 'period',
        'status', 'output', 'estimated_credits', 'credits_used',
        'model', 'error_message', 'completed_at', 'started_at', 'created_at',
        'input_summary', 'metadata',
      ].join(', '))
      .eq('id', analysisId)
      .single()

    if (fetchErr || !analysis) { jsonError(res, 404, 'Análise não encontrada'); return }

    // 4. Validar membership
    const membership = await assertMembership(svc, user.id, analysis.company_id)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // 5. Construir resposta conforme status
    const base = {
      id:              analysis.id,
      analysis_type:   analysis.analysis_type,
      funnel_id:       analysis.funnel_id,
      period:          analysis.period,
      status:          analysis.status,
      model:           analysis.model,
      created_at:      analysis.created_at,
      started_at:      analysis.started_at,
      completed_at:    analysis.completed_at,
    }

    if (analysis.status === 'completed') {
      return res.status(200).json({
        ok:   true,
        data: { ...base, output: analysis.output, credits_used: analysis.credits_used },
      })
    }

    if (analysis.status === 'credit_failed') {
      // output bloqueado — expor apenas o que é necessário para o usuário agir
      const balance = await getBalance(svc, analysis.company_id)
      return res.status(200).json({
        ok:   true,
        data: {
          ...base,
          output:            null, // bloqueado intencionalmente
          credits_used:      analysis.credits_used,
          estimated_credits: analysis.estimated_credits,
          balance_available: balance,
          required_balance:  Math.ceil((analysis.credits_used ?? analysis.estimated_credits ?? 0) * MARGIN_FACTOR),
          error_message:     'Créditos insuficientes para liberar o resultado.',
          message:           'Compre créditos e retome a análise enviando POST com { analysis_id }.',
        },
      })
    }

    if (analysis.status === 'awaiting_credits') {
      const balance = await getBalance(svc, analysis.company_id)
      const requiredBalance = Math.ceil((analysis.estimated_credits ?? 0) * MARGIN_FACTOR)
      return res.status(200).json({
        ok:   true,
        data: {
          ...base,
          output:            null,
          estimated_credits: analysis.estimated_credits,
          balance_available: balance,
          required_balance:  requiredBalance,
          missing_credits:   Math.max(0, requiredBalance - balance),
          message:           'Saldo insuficiente. Compre créditos e retome com POST { analysis_id }.',
        },
      })
    }

    // processing, pending, failed
    return res.status(200).json({
      ok:   true,
      data: {
        ...base,
        output:        null,
        error_message: analysis.status === 'failed' ? analysis.error_message : null,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/ai-analysis/[id]] Erro inesperado:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

async function getBalance(svc: any, companyId: string): Promise<number> {
  const { data } = await svc
    .from('company_credits').select('plan_credits, extra_credits')
    .eq('company_id', companyId).maybeSingle()
  return (data?.plan_credits ?? 0) + (data?.extra_credits ?? 0)
}
