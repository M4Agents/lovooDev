// =====================================================
// GET /api/contact-cycles/[opportunityId]/state
//
// Retorna o estado consolidado do ciclo de contato de uma oportunidade.
// Usado pelo modal de tentativa e pelo badge do Kanban.
//
// Fontes:
//   - RPC evaluate_contact_cycle_eligibility → elegibilidade
//   - opportunity_funnel_positions            → campos derivados
//   - contact_attempts (COUNT)               → tentativas do ciclo atual
//
// Leitura pura — não altera nenhum dado, não cria ciclo,
// não registra tentativa e não fecha ciclo.
//
// Query params:
//   company_id (obrigatório)
// =====================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

// Retorno neutro quando opportunity não tem posição em funil
const NEUTRAL_POSITION = {
  contact_attempts_state:       'none',
  current_contact_cycle_id:     null,
  contact_cycle_opened_at:      null,
  total_contact_attempts:       0,
  last_contact_attempt_at:      null,
  last_cycle_close_reason:      null,
  eligible_for_new_cycle_at:    null,
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method !== 'GET') {
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
    // ------------------------------------------------------------------
    const { data: opportunity, error: oppError } = await svc
      .from('opportunities')
      .select('id, company_id')
      .eq('id', opportunityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (oppError) {
      console.error('[contact-cycles/state] opportunity lookup error:', oppError)
      jsonError(res, 500, 'Erro ao verificar oportunidade')
      return
    }

    if (!opportunity) {
      jsonError(res, 404, 'Oportunidade não encontrada')
      return
    }

    // ------------------------------------------------------------------
    // 5. Buscar campos derivados em opportunity_funnel_positions
    //    Leitura opcional: se não existir posição, usar valores neutros
    // ------------------------------------------------------------------
    const { data: position, error: posError } = await svc
      .from('opportunity_funnel_positions')
      .select(
        'contact_attempts_state, current_contact_cycle_id, contact_cycle_opened_at, ' +
        'total_contact_attempts, last_contact_attempt_at, last_cycle_close_reason, ' +
        'eligible_for_new_cycle_at',
      )
      .eq('opportunity_id', opportunityId)
      .maybeSingle()

    if (posError) {
      console.error('[contact-cycles/state] position lookup error:', posError)
      jsonError(res, 500, 'Erro ao buscar posição em funil')
      return
    }

    const pos = position ?? NEUTRAL_POSITION

    // ------------------------------------------------------------------
    // 6. Contagem de tentativas do ciclo atual (somente se ciclo aberto)
    //    Não conta tentativas canceladas
    // ------------------------------------------------------------------
    let currentCycleAttemptsCount = 0

    if (pos.current_contact_cycle_id) {
      const { count, error: countError } = await svc
        .from('contact_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('cycle_id', pos.current_contact_cycle_id)
        .eq('company_id', companyId)
        .is('cancelled_at', null)

      if (!countError) {
        currentCycleAttemptsCount = count ?? 0
      } else {
        console.warn('[contact-cycles/state] attempt count error:', countError)
        // Não bloqueia — retorna 0 como fallback seguro
      }
    }

    // ------------------------------------------------------------------
    // 7. Chamar RPC de elegibilidade
    // ------------------------------------------------------------------
    const { data: eligibility, error: rpcError } = await svc.rpc(
      'evaluate_contact_cycle_eligibility',
      { p_opportunity_id: opportunityId, p_company_id: companyId },
    )

    if (rpcError) {
      console.error('[contact-cycles/state] evaluate_contact_cycle_eligibility error:', rpcError)
      jsonError(res, 500, 'Erro ao avaliar elegibilidade do ciclo')
      return
    }

    // ------------------------------------------------------------------
    // 8. Resposta consolidada
    // ------------------------------------------------------------------
    res.status(200).json({
      ok: true,
      data: {
        eligibility:                  eligibility ?? 'unknown',
        current_contact_cycle_id:     pos.current_contact_cycle_id,
        contact_attempts_state:       pos.contact_attempts_state ?? 'none',
        current_cycle_attempts_count: currentCycleAttemptsCount,
        total_contact_attempts_count: pos.total_contact_attempts ?? 0,
        next_attempt_eligible_at:     pos.eligible_for_new_cycle_at,
        last_agent_contact_at:        pos.last_contact_attempt_at,
        last_customer_reply_at:       null, // não disponível no schema atual
      },
    })

  } catch (err) {
    console.error('[contact-cycles/state] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
