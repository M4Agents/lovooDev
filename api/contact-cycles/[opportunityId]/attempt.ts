// =====================================================
// POST /api/contact-cycles/[opportunityId]/attempt
//
// Registra uma tentativa de contato para uma oportunidade.
// Chama a RPC register_contact_attempt após validações de segurança.
//
// Campos aceitos do body:
//   company_id           (obrigatório)
//   trigger_reason       (obrigatório — 'manual' | 'whatsapp_sent' | 'whatsapp_received' | 'system')
//   reason_id            (opcional UUID — motivo comercial; null permitido)
//   whatsapp_message_id  (opcional text)
//   notes                (opcional text)
//   answers              (opcional array de { question_id: uuid, value: string })
//
// Campos NUNCA aceitos do body (derivados no backend):
//   lead_id, funnel_stage_id
//
// RBAC: seller+ (qualquer membro ativo)
// =====================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

// Valores válidos conforme validação na RPC register_contact_attempt
const VALID_TRIGGER_REASONS = new Set(['manual', 'whatsapp_sent', 'whatsapp_received', 'system'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method !== 'POST') {
    jsonError(res, 405, 'Método não permitido')
    return
  }

  try {
    // ------------------------------------------------------------------
    // 1. Auth
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // ------------------------------------------------------------------
    // 2. company_id + membership (seller+ tem acesso)
    // ------------------------------------------------------------------
    const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id.trim() : ''
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
    // 4. Anti-IDOR + derivação de lead_id no backend
    //    Nunca confiar em lead_id vindo do body
    // ------------------------------------------------------------------
    const { data: opportunity, error: oppError } = await svc
      .from('opportunities')
      .select('id, company_id, lead_id')
      .eq('id', opportunityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (oppError) {
      console.error('[contact-cycles/attempt] opportunity lookup error:', oppError)
      jsonError(res, 500, 'Erro ao verificar oportunidade')
      return
    }

    if (!opportunity) {
      jsonError(res, 404, 'Oportunidade não encontrada')
      return
    }

    const leadId: number | null = opportunity.lead_id ?? null

    // ------------------------------------------------------------------
    // 5. Derivar funnel_stage_id + estado atual do ciclo no backend
    //    Nunca confiar em stage_id ou cycle_id vindo do body
    // ------------------------------------------------------------------
    const { data: position, error: posError } = await svc
      .from('opportunity_funnel_positions')
      .select('stage_id, current_contact_cycle_id, contact_attempts_state')
      .eq('opportunity_id', opportunityId)
      .maybeSingle()

    if (posError) {
      console.error('[contact-cycles/attempt] position lookup error:', posError)
      jsonError(res, 500, 'Erro ao buscar posição em funil')
      return
    }

    const funnelStageId: string | null = position?.stage_id ?? null
    const existingCycleId: string | null = position?.current_contact_cycle_id ?? null
    const cycleState: string = position?.contact_attempts_state ?? 'none'

    // ------------------------------------------------------------------
    // 6. Validar campos do body
    // ------------------------------------------------------------------
    const body = req.body ?? {}

    // trigger_reason — obrigatório
    const triggerReason = typeof body.trigger_reason === 'string' ? body.trigger_reason.trim() : ''
    if (!triggerReason || !VALID_TRIGGER_REASONS.has(triggerReason)) {
      jsonError(
        res,
        400,
        `trigger_reason inválido — valores aceitos: ${[...VALID_TRIGGER_REASONS].join(', ')}`,
      )
      return
    }

    // reason_id — opcional, null permitido
    let reasonId: string | null = null
    if ('reason_id' in body && body.reason_id !== null && body.reason_id !== undefined) {
      if (typeof body.reason_id !== 'string' || body.reason_id.trim() === '') {
        jsonError(res, 400, 'reason_id deve ser um UUID válido ou null')
        return
      }
      reasonId = body.reason_id.trim()
    }

    // whatsapp_message_id — opcional
    const whatsappMessageId: string | null =
      typeof body.whatsapp_message_id === 'string' && body.whatsapp_message_id.trim()
        ? body.whatsapp_message_id.trim()
        : null

    // notes — opcional
    const notes: string | null =
      typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.trim()
        : null

    // answers — opcional, array vazio permitido
    const rawAnswers = body.answers
    const answers: Array<{ question_id: string; value: string }> = []

    if (rawAnswers !== undefined && rawAnswers !== null) {
      if (!Array.isArray(rawAnswers)) {
        jsonError(res, 400, 'answers deve ser um array')
        return
      }
      // Validar estrutura de cada item
      for (const item of rawAnswers) {
        if (typeof item !== 'object' || item === null) {
          jsonError(res, 400, 'Cada item de answers deve ser um objeto { question_id, value }')
          return
        }
        if (typeof item.question_id !== 'string' || !item.question_id.trim()) {
          jsonError(res, 400, 'Cada item de answers deve conter question_id (UUID)')
          return
        }
        if (item.value !== undefined && typeof item.value !== 'string') {
          jsonError(res, 400, 'O campo value em answers deve ser string')
          return
        }
        answers.push({ question_id: item.question_id.trim(), value: item.value ?? '' })
      }
    }

    // ------------------------------------------------------------------
    // 7. Validar reason_id contra a empresa (anti-IDOR + estado ativo)
    // ------------------------------------------------------------------
    if (reasonId !== null) {
      const { data: reason, error: reasonError } = await svc
        .from('contact_attempt_reasons')
        .select('id')
        .eq('id', reasonId)
        .eq('company_id', companyId)
        .eq('active', true)
        .maybeSingle()

      if (reasonError) {
        console.error('[contact-cycles/attempt] reason lookup error:', reasonError)
        jsonError(res, 500, 'Erro ao verificar motivo de contato')
        return
      }

      if (!reason) {
        jsonError(res, 422, 'reason_id inválido, inativo ou não pertence a esta empresa')
        return
      }
    }

    // ------------------------------------------------------------------
    // 8. Validar question_ids das answers (anti-IDOR + estado ativo)
    // ------------------------------------------------------------------
    if (answers.length > 0) {
      const questionIds = answers.map(a => a.question_id)

      const { data: validQuestions, error: qError } = await svc
        .from('contact_attempt_questions')
        .select('id')
        .eq('company_id', companyId)
        .eq('active', true)
        .in('id', questionIds)

      if (qError) {
        console.error('[contact-cycles/attempt] question validation error:', qError)
        jsonError(res, 500, 'Erro ao validar perguntas')
        return
      }

      const validIds = new Set((validQuestions ?? []).map((q: { id: string }) => q.id))
      const invalidId = questionIds.find(id => !validIds.has(id))

      if (invalidId) {
        jsonError(res, 422, `question_id inválido, inativo ou não pertence a esta empresa: ${invalidId}`)
        return
      }
    }

    // ------------------------------------------------------------------
    // 9. Garantir ciclo aberto — abrir automaticamente se não existir
    //    Encapsula a lógica de abertura para o frontend fazer apenas 1 chamada.
    //    Proteção: se o estado for 'waiting' (cooldown), nega antes de abrir.
    // ------------------------------------------------------------------
    if (!existingCycleId) {
      if (cycleState === 'waiting') {
        jsonError(res, 422, 'Oportunidade em período de cooldown — aguarde antes da próxima tentativa')
        return
      }

      const { error: openError } = await svc.rpc('open_contact_cycle', {
        p_opportunity_id: opportunityId,
        p_company_id:     companyId,
        p_opened_by:      user.id,
      })

      if (openError) {
        const openMsg = openError.message ?? ''

        if (openMsg.includes('uq_one_open_cycle') || openMsg.includes('duplicate key')) {
          // Race condition: outro processo abriu o ciclo em paralelo — prosseguir normalmente
        } else if (openMsg.includes('INVALID_STATE')) {
          jsonError(res, 422, 'Não é possível abrir ciclo: a etapa atual não rastreia tentativas de contato')
          return
        } else if (openMsg.includes('UNAUTHORIZED')) {
          jsonError(res, 403, 'Sem permissão para abrir ciclo nesta oportunidade')
          return
        } else {
          console.error('[contact-cycles/attempt] open_contact_cycle error:', openError)
          jsonError(res, 500, 'Erro ao abrir ciclo de contato')
          return
        }
      }
    }

    // ------------------------------------------------------------------
    // 10. Chamar RPC register_contact_attempt
    //     lead_id e funnel_stage_id derivados no backend — nunca do body
    // ------------------------------------------------------------------
    const { data: attemptId, error: rpcError } = await svc.rpc('register_contact_attempt', {
      p_opportunity_id:      opportunityId,
      p_company_id:          companyId,
      p_actor_id:            user.id,
      p_trigger_reason:      triggerReason,
      p_reason_id:           reasonId,
      p_lead_id:             leadId,
      p_funnel_stage_id:     funnelStageId,
      p_whatsapp_message_id: whatsappMessageId,
      p_notes:               notes,
      p_answers:             answers.length > 0 ? answers : null,
    })

    if (rpcError) {
      // #region agent log H-A
      console.error('[contact-cycles/attempt] register_contact_attempt error:', JSON.stringify(rpcError))
      // #endregion

      // Erros de negócio da RPC — mensagem controlada ao frontend
      const msg = rpcError.message ?? ''
      if (msg.includes('INVALID_STATE')) {
        // Sem ciclo aberto, estado inconsistente etc.
        jsonError(res, 422, 'Não é possível registrar tentativa: ' + extractRpcMessage(msg))
        return
      }
      if (msg.includes('UNAUTHORIZED')) {
        jsonError(res, 403, 'Acesso negado pela validação de banco')
        return
      }
      if (msg.includes('INVALID_PARAM')) {
        jsonError(res, 422, 'Parâmetro inválido: ' + extractRpcMessage(msg))
        return
      }

      jsonError(res, 500, 'Erro ao registrar tentativa de contato')
      return
    }

    res.status(201).json({ ok: true, data: { attempt_id: attemptId } })

  } catch (err) {
    console.error('[contact-cycles/attempt] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

// Extrai a parte legível de uma mensagem de erro de RPC (após o prefixo de código)
function extractRpcMessage(msg: string): string {
  const colonIdx = msg.indexOf(':')
  return colonIdx !== -1 ? msg.slice(colonIdx + 1).trim() : msg
}
