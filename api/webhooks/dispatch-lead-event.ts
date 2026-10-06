// POST /api/webhooks/dispatch-lead-event
//
// Dispara o Webhook Avançado depois de criar ou atualizar um lead no CRM.
// company_id vem do lead no banco. O cliente informa o status anterior
// para distinguir lead_updated de lead_converted.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, assertMembership, jsonError } from '../lib/dashboard/auth.js'
import { resolveLeadWebhookEvent, triggerAdvancedWebhooks } from '../lib/webhook/triggerAdvancedWebhooks.js'

const REASONS = new Set(['created', 'updated'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }
  if (req.method !== 'POST') return jsonError(res, 405, 'Método não permitido')

  const token = extractToken(req.headers.authorization)
  if (!token) return jsonError(res, 401, 'Token de autenticação ausente')

  const { user, error: authError } = await getUserFromToken(token)
  if (authError || !user) return jsonError(res, 401, 'Sessão inválida ou expirada')

  const body = (req.body ?? {}) as {
    lead_id?: unknown
    reason?: unknown
    previous_status?: unknown
  }

  const leadId = body.lead_id
  if (!Number.isInteger(leadId) || (leadId as number) <= 0) {
    return jsonError(res, 400, 'lead_id inválido')
  }
  if (typeof body.reason !== 'string' || !REASONS.has(body.reason)) {
    return jsonError(res, 400, 'reason inválido')
  }
  if (body.previous_status != null && typeof body.previous_status !== 'string') {
    return jsonError(res, 400, 'previous_status inválido')
  }
  if (typeof body.previous_status === 'string' && body.previous_status.length > 50) {
    return jsonError(res, 400, 'previous_status inválido')
  }

  const svc = getSupabaseAdmin()
  const { data: lead, error: leadError } = await svc
    .from('leads')
    .select('id, company_id, status, deleted_at')
    .eq('id', leadId as number)
    .maybeSingle()

  if (leadError) return jsonError(res, 500, 'Erro ao buscar lead')
  if (!lead || lead.deleted_at) return jsonError(res, 404, 'Lead não encontrado')

  const member = await assertMembership(svc, user.id, lead.company_id)
  if (!member) return jsonError(res, 403, 'Acesso negado a esta empresa')

  const event = resolveLeadWebhookEvent({
    reason: body.reason,
    previousStatus: typeof body.previous_status === 'string' ? body.previous_status : null,
    currentStatus: lead.status,
  })

  await triggerAdvancedWebhooks({
    supabase: svc,
    companyId: lead.company_id,
    leadId: lead.id,
    event,
  })

  return res.status(200).json({ ok: true, event })
}
