// =====================================================
// GET /api/contact-cycles/by-lead/[leadId]
//
// Resolve a oportunidade ativa de um lead e avalia elegibilidade
// para registrar uma tentativa de contato.
//
// Chamado pelo hook useContactCycleState após envio de mensagem.
// Deve ser barato, silencioso e nunca alterar dados.
//
// Lógica:
//   1. resolve_opportunity_for_contact_cycle(leadId, companyId)
//      → opp aberta + etapa com rastreamento → opportunity_id | null
//   2. Se null → eligible_for_attempt: false (sem erro)
//   3. evaluate_contact_cycle_eligibility(opportunityId, companyId)
//      → 'eligible' | 'cycle_open' | 'waiting' | 'disabled' | 'no_config'
//   4. eligible_for_attempt = eligibility IN ('eligible', 'cycle_open')
//   5. Buscar derived fields de opportunity_funnel_positions
//   6. Contar tentativas ativas do ciclo atual (se houver)
//
// RBAC: seller+ (qualquer membro ativo)
// Somente leitura — nenhum dado é alterado.
// =====================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

// Elegibilidade que permite registrar tentativa
const ELIGIBLE_STATES = new Set(['eligible', 'cycle_open'])

// Mapeamento de eligibility → reason legível
function buildReason(eligibility: string | null): string {
  switch (eligibility) {
    case 'eligible':   return 'Elegível para novo ciclo de contato.'
    case 'cycle_open': return 'Ciclo de contato aberto — nova tentativa permitida.'
    case 'waiting':    return 'Aguardando período de cooldown antes do próximo ciclo.'
    case 'disabled':   return 'Módulo desabilitado ou etapa não rastreia tentativas.'
    case 'no_config':  return 'Configuração de ciclos não encontrada para esta empresa.'
    default:           return 'Elegibilidade não determinada.'
  }
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
    const companyId =
      typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. leadId da rota dinâmica — deve ser inteiro positivo
    // ------------------------------------------------------------------
    const rawLeadId = req.query.leadId ?? req.query['leadId']
    const leadId = parseInt(String(rawLeadId), 10)

    if (!rawLeadId || isNaN(leadId) || leadId <= 0 || !Number.isInteger(leadId)) {
      jsonError(res, 400, 'leadId deve ser um número inteiro positivo')
      return
    }

    // ------------------------------------------------------------------
    // 4. Resolver opportunity via RPC SECURITY DEFINER
    //    Filtra: opp aberta, etapa com track_contact_attempts = true
    //    Retorna null se não houver oportunidade elegível
    // ------------------------------------------------------------------
    const { data: opportunityId, error: resolveError } = await svc.rpc(
      'resolve_opportunity_for_contact_cycle',
      { p_lead_id: leadId, p_company_id: companyId },
    )

    if (resolveError) {
      console.error('[by-lead] resolve_opportunity error:', resolveError)
      jsonError(res, 500, 'Erro ao resolver oportunidade')
      return
    }

    // Sem oportunidade ativa com rastreamento → resposta neutra, sem erro
    if (!opportunityId) {
      return res.status(200).json({
        ok: true,
        data: {
          opportunity_id:              null,
          eligibility:                 'no_opportunity',
          eligible_for_attempt:        false,
          contact_attempts_state:      'none',
          current_contact_cycle_id:    null,
          current_cycle_attempts_count: 0,
          total_contact_attempts_count: 0,
          last_contact_attempt_at:     null,
          eligible_for_new_cycle_at:   null,
          reason: 'Nenhuma oportunidade aberta com rastreamento de tentativas encontrada para este lead.',
        },
      })
    }

    // ------------------------------------------------------------------
    // 5. Avaliar elegibilidade via RPC
    //    Retorna: 'eligible' | 'cycle_open' | 'waiting' | 'disabled' | 'no_config'
    // ------------------------------------------------------------------
    const { data: eligibility, error: eligibilityError } = await svc.rpc(
      'evaluate_contact_cycle_eligibility',
      { p_opportunity_id: opportunityId, p_company_id: companyId },
    )

    if (eligibilityError) {
      console.error('[by-lead] evaluate_eligibility error:', eligibilityError)
      jsonError(res, 500, 'Erro ao avaliar elegibilidade')
      return
    }

    // ------------------------------------------------------------------
    // 6. Buscar derived fields de opportunity_funnel_positions
    // ------------------------------------------------------------------
    const { data: position, error: posError } = await svc
      .from('opportunity_funnel_positions')
      .select(
        'contact_attempts_state, current_contact_cycle_id, total_contact_attempts, last_contact_attempt_at, eligible_for_new_cycle_at',
      )
      .eq('opportunity_id', opportunityId)
      .maybeSingle()

    if (posError) {
      console.error('[by-lead] position fetch error:', posError)
      jsonError(res, 500, 'Erro ao buscar posição em funil')
      return
    }

    // ------------------------------------------------------------------
    // 7. Contar tentativas não-canceladas do ciclo atual
    //    (derived field total_contact_attempts é global; precisamos do ciclo atual)
    // ------------------------------------------------------------------
    let currentCycleAttemptsCount = 0
    const cycleId: string | null = position?.current_contact_cycle_id ?? null

    if (cycleId) {
      const { count, error: countError } = await svc
        .from('contact_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('cycle_id', cycleId)
        .is('cancelled_at', null)

      if (!countError) {
        currentCycleAttemptsCount = count ?? 0
      }
    }

    // ------------------------------------------------------------------
    // 8. Determinar eligible_for_attempt
    //    true apenas quando 'eligible' (novo ciclo) ou 'cycle_open' (tentativa em ciclo ativo)
    // ------------------------------------------------------------------
    const eligibleForAttempt = ELIGIBLE_STATES.has(eligibility ?? '')

    // ------------------------------------------------------------------
    // 9. Resposta consolidada
    // ------------------------------------------------------------------
    res.status(200).json({
      ok: true,
      data: {
        opportunity_id:               opportunityId,
        eligibility:                  eligibility ?? 'unknown',
        eligible_for_attempt:         eligibleForAttempt,
        contact_attempts_state:       position?.contact_attempts_state ?? 'none',
        current_contact_cycle_id:     cycleId,
        current_cycle_attempts_count: currentCycleAttemptsCount,
        total_contact_attempts_count: position?.total_contact_attempts ?? 0,
        last_contact_attempt_at:      position?.last_contact_attempt_at ?? null,
        eligible_for_new_cycle_at:    position?.eligible_for_new_cycle_at ?? null,
        reason:                       buildReason(eligibility),
      },
    })

  } catch (err) {
    console.error('[by-lead] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
