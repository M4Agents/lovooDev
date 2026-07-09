// =====================================================
// GET /api/contact-cycles/[opportunityId]/attempts
//
// Lista todas as tentativas de contato de uma oportunidade.
// Inclui tentativas canceladas.
//
// Query params:
//   company_id  (obrigatório)
//   cycle_id    (opcional — filtra por ciclo específico)
//
// Retorno por tentativa:
//   attempt_id, cycle_id, trigger_reason, reason_label,
//   notes, created_at, cancelled_at, actor_id,
//   answers[]: { question_id, question_label, value }
//
// RBAC: seller+ (leitura pura)
// Anti-IDOR:
//   1. opportunity pertence à company_id
//   2. cycle_id (se fornecido) pertence à opportunity + company
//   3. query sempre ancorada em opportunity_id + company_id derivados do banco
// =====================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

const MAX_ATTEMPTS = 200

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method !== 'GET') {
    jsonError(res, 405, 'Método não permitido')
    return
  }

  try {
    // ------------------------------------------------------------------
    // 1. Auth — JWT obrigatório
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // ------------------------------------------------------------------
    // 2. company_id + membership ativo (seller+ tem acesso)
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. opportunityId da rota dinâmica
    // ------------------------------------------------------------------
    const opportunityId =
      typeof req.query.opportunityId === 'string' ? req.query.opportunityId.trim() : ''
    if (!opportunityId) { jsonError(res, 400, 'opportunityId é obrigatório'); return }

    // ------------------------------------------------------------------
    // 4. Anti-IDOR — confirmar que opportunity pertence à empresa
    //    Nunca confiar em opportunityId vindo do body
    // ------------------------------------------------------------------
    const { data: opportunity, error: oppError } = await svc
      .from('opportunities')
      .select('id, company_id')
      .eq('id', opportunityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (oppError) {
      console.error('[contact-cycles/attempts] opportunity lookup error:', oppError)
      jsonError(res, 500, 'Erro ao verificar oportunidade')
      return
    }

    if (!opportunity) {
      jsonError(res, 404, 'Oportunidade não encontrada')
      return
    }

    // ------------------------------------------------------------------
    // 5. cycle_id opcional — validar anti-IDOR com tripla âncora
    //    cycle deve pertencer à mesma opportunity E à mesma company
    // ------------------------------------------------------------------
    const cycleIdParam = typeof req.query.cycle_id === 'string' ? req.query.cycle_id.trim() : null

    if (cycleIdParam) {
      const { data: cycle, error: cycleError } = await svc
        .from('contact_attempt_cycles')
        .select('id')
        .eq('id', cycleIdParam)
        .eq('opportunity_id', opportunityId)  // âncora 1: opportunity correta
        .eq('company_id', companyId)           // âncora 2: company correta
        .maybeSingle()

      if (cycleError) {
        console.error('[contact-cycles/attempts] cycle lookup error:', cycleError)
        jsonError(res, 500, 'Erro ao verificar ciclo')
        return
      }

      if (!cycle) {
        jsonError(res, 404, 'Ciclo não encontrado')
        return
      }
    }

    // ------------------------------------------------------------------
    // 6. Buscar tentativas com joins para reason_label e answers
    //    opportunity_id e company_id são sempre derivados do banco
    //    Tentativas canceladas INCLUÍDAS (sem filtro em cancelled_at)
    // ------------------------------------------------------------------
    let query = svc
      .from('contact_attempts')
      .select(`
        id,
        cycle_id,
        trigger_reason,
        created_at,
        cancelled_at,
        actor_id,
        notes,
        contact_attempt_reasons ( label ),
        contact_attempt_answers (
          question_id,
          value,
          contact_attempt_questions ( label )
        )
      `)
      .eq('opportunity_id', opportunityId)
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
      .limit(MAX_ATTEMPTS)

    if (cycleIdParam) {
      query = query.eq('cycle_id', cycleIdParam)
    }

    const { data: rows, error: attemptsError } = await query

    if (attemptsError) {
      console.error('[contact-cycles/attempts] attempts query error:', attemptsError)
      jsonError(res, 500, 'Erro ao buscar tentativas')
      return
    }

    // ------------------------------------------------------------------
    // 7. Normalizar resposta
    // ------------------------------------------------------------------
    const attempts = (rows ?? []).map((row: any) => ({
      attempt_id:     row.id,
      cycle_id:       row.cycle_id,
      trigger_reason: row.trigger_reason,
      reason_label:   row.contact_attempt_reasons?.label ?? null,
      notes:          row.notes ?? null,
      created_at:     row.created_at,
      cancelled_at:   row.cancelled_at ?? null,
      actor_id:       row.actor_id,
      answers: (row.contact_attempt_answers ?? []).map((a: any) => ({
        question_id:    a.question_id,
        question_label: a.contact_attempt_questions?.label ?? '',
        value:          a.value ?? '',
      })),
    }))

    res.status(200).json({ ok: true, data: { attempts } })

  } catch (err) {
    console.error('[contact-cycles/attempts] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
