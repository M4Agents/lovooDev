// =====================================================
// POST /api/contact-cycles/[opportunityId]/close
//
// Fecha manualmente o ciclo de contato ativo de uma oportunidade.
// Chama a RPC close_contact_cycle — idempotente (sem ciclo aberto: no-op).
//
// RBAC: manager, admin, system_admin, super_admin
//   seller NÃO pode fechar ciclo manualmente.
//
// Campos aceitos do body:
//   company_id    (obrigatório)
//   close_reason  (opcional — default: 'manual')
//
// Campos NUNCA aceitos:
//   cycle_id (a RPC localiza o ciclo pelo opportunity_id)
// =====================================================

import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

// Roles com permissão de fechar ciclo manualmente
const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

// Motivos de fechamento aceitos via API manual
// Razões automáticas (opportunity_won, opportunity_lost, stage_changed_without_tracking,
// inbound_received) são definidas pelas RPCs internas — não aceitas aqui.
const VALID_CLOSE_REASONS = new Set([
  'manual',
  'goal_reached',
  'no_response',
  'duplicate',
  'inbound_received',
])

const DEFAULT_CLOSE_REASON = 'manual'

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
    // 2. company_id + membership
    // ------------------------------------------------------------------
    const companyId = typeof req.body?.company_id === 'string' ? req.body.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. RBAC — seller não pode fechar ciclo manualmente
    // ------------------------------------------------------------------
    if (!MANAGER_ROLES.has(membership.role)) {
      jsonError(res, 403, 'Permissão insuficiente — requer manager, admin, system_admin ou super_admin')
      return
    }

    // ------------------------------------------------------------------
    // 4. opportunityId da rota dinâmica
    // ------------------------------------------------------------------
    const opportunityId =
      typeof req.query.opportunityId === 'string' ? req.query.opportunityId.trim() : ''
    if (!opportunityId) { jsonError(res, 400, 'opportunityId é obrigatório'); return }

    // ------------------------------------------------------------------
    // 5. Anti-IDOR — confirmar que opportunity pertence à empresa
    // ------------------------------------------------------------------
    const { data: opportunity, error: oppError } = await svc
      .from('opportunities')
      .select('id')
      .eq('id', opportunityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (oppError) {
      console.error('[contact-cycles/close] opportunity lookup error:', oppError)
      jsonError(res, 500, 'Erro ao verificar oportunidade')
      return
    }

    if (!opportunity) {
      jsonError(res, 404, 'Oportunidade não encontrada')
      return
    }

    // ------------------------------------------------------------------
    // 6. Validar close_reason (opcional — default 'manual')
    // ------------------------------------------------------------------
    const body = req.body ?? {}
    let closeReason = DEFAULT_CLOSE_REASON

    if ('close_reason' in body && body.close_reason !== null && body.close_reason !== undefined) {
      if (typeof body.close_reason !== 'string' || !body.close_reason.trim()) {
        jsonError(res, 400, 'close_reason deve ser uma string não vazia')
        return
      }
      const sanitized = body.close_reason.trim()
      if (!VALID_CLOSE_REASONS.has(sanitized)) {
        jsonError(
          res,
          400,
          `close_reason inválido — valores aceitos: ${[...VALID_CLOSE_REASONS].join(', ')}`,
        )
        return
      }
      closeReason = sanitized
    }

    // ------------------------------------------------------------------
    // 7. Chamar RPC close_contact_cycle
    //    Idempotente: se não houver ciclo aberto, retorna sem erro.
    //    cycle_id nunca aceito do frontend — a RPC localiza pelo opportunity_id.
    // ------------------------------------------------------------------
    const { error: rpcError } = await svc.rpc('close_contact_cycle', {
      p_opportunity_id: opportunityId,
      p_company_id:     companyId,
      p_closed_by:      user.id,
      p_close_reason:   closeReason,
    })

    if (rpcError) {
      console.error('[contact-cycles/close] close_contact_cycle error:', rpcError)

      const msg = rpcError.message ?? ''
      if (msg.includes('UNAUTHORIZED')) {
        jsonError(res, 403, 'Acesso negado pela validação de banco')
        return
      }

      jsonError(res, 500, 'Erro ao fechar ciclo de contato')
      return
    }

    res.status(200).json({ ok: true, data: { closed: true, close_reason: closeReason } })

  } catch (err) {
    console.error('[contact-cycles/close] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
