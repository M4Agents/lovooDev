// =====================================================
// DELETE /api/contact-cycles/[opportunityId]/attempt/[attemptId]
//
// Cancela (soft delete) uma tentativa de contato.
// Chama a RPC cancel_contact_attempt, que:
//   - seta cancelled_at = now()
//   - decrementa total_contact_attempts em opportunity_funnel_positions
//   - registra evento 'attempt_cancelled' em opportunity_timeline_events
//
// A RPC valida company_id e cancelled_at IS NULL internamente.
// A API valida adicionalmente que attemptId pertence ao opportunityId
// para evitar cross-opportunity access dentro da mesma empresa.
//
// RBAC: manager, admin, system_admin, super_admin
//   seller NÃO pode cancelar tentativa.
// =====================================================

import { getSupabaseAdmin } from '../../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../../../lib/dashboard/auth.js'

const MANAGER_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method !== 'DELETE') {
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
    const companyId =
      typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 3. RBAC — seller não pode cancelar tentativa
    // ------------------------------------------------------------------
    if (!MANAGER_ROLES.has(membership.role)) {
      jsonError(res, 403, 'Permissão insuficiente — requer manager, admin, system_admin ou super_admin')
      return
    }

    // ------------------------------------------------------------------
    // 4. IDs da rota dinâmica
    // ------------------------------------------------------------------
    const opportunityId =
      typeof req.query.opportunityId === 'string' ? req.query.opportunityId.trim() : ''
    if (!opportunityId) { jsonError(res, 400, 'opportunityId é obrigatório'); return }

    const attemptId =
      typeof req.query.attemptId === 'string' ? req.query.attemptId.trim() : ''
    if (!attemptId) { jsonError(res, 400, 'attemptId é obrigatório'); return }

    // ------------------------------------------------------------------
    // 5. Anti-IDOR — confirmar que opportunityId pertence à empresa
    // ------------------------------------------------------------------
    const { data: opportunity, error: oppError } = await svc
      .from('opportunities')
      .select('id')
      .eq('id', opportunityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (oppError) {
      console.error('[contact-cycles/attempt/cancel] opportunity lookup error:', oppError)
      jsonError(res, 500, 'Erro ao verificar oportunidade')
      return
    }

    if (!opportunity) {
      jsonError(res, 404, 'Oportunidade não encontrada')
      return
    }

    // ------------------------------------------------------------------
    // 6. Anti-IDOR — confirmar que attemptId pertence ao opportunityId e company_id
    //    A RPC valida company_id mas não opportunity_id.
    //    Esta checagem evita cross-opportunity access dentro da mesma empresa.
    // ------------------------------------------------------------------
    const { data: attempt, error: attemptLookupError } = await svc
      .from('contact_attempts')
      .select('id, cancelled_at')
      .eq('id', attemptId)
      .eq('opportunity_id', opportunityId)
      .eq('company_id', companyId)
      .maybeSingle()

    if (attemptLookupError) {
      console.error('[contact-cycles/attempt/cancel] attempt lookup error:', attemptLookupError)
      jsonError(res, 500, 'Erro ao verificar tentativa')
      return
    }

    if (!attempt) {
      jsonError(res, 404, 'Tentativa não encontrada')
      return
    }

    // Tentativa já cancelada — resposta controlada sem erro 500
    if (attempt.cancelled_at !== null) {
      jsonError(res, 409, 'Tentativa já foi cancelada')
      return
    }

    // ------------------------------------------------------------------
    // 7. Chamar RPC cancel_contact_attempt
    //    Soft delete: seta cancelled_at, decrementa contador, cria evento.
    //    Não realiza DELETE físico.
    // ------------------------------------------------------------------
    const { error: rpcError } = await svc.rpc('cancel_contact_attempt', {
      p_attempt_id: attemptId,
      p_company_id: companyId,
      p_actor_id:   user.id,
    })

    if (rpcError) {
      console.error('[contact-cycles/attempt/cancel] cancel_contact_attempt error:', rpcError)

      const msg = rpcError.message ?? ''
      if (msg.includes('INVALID_STATE')) {
        // Já cancelada ou não encontrada — tratado antes, mas como fallback
        jsonError(res, 409, 'Tentativa já cancelada ou não disponível para cancelamento')
        return
      }
      if (msg.includes('UNAUTHORIZED')) {
        jsonError(res, 403, 'Acesso negado pela validação de banco')
        return
      }

      jsonError(res, 500, 'Erro ao cancelar tentativa de contato')
      return
    }

    res.status(200).json({ ok: true, data: { cancelled: true, attempt_id: attemptId } })

  } catch (err) {
    console.error('[contact-cycles/attempt/cancel] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
