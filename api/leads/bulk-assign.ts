// =====================================================
// POST /api/leads/bulk-assign
//
// Atribui responsável em lote para múltiplos leads.
//
// Body: { leadIds: number[], responsibleUserId: string | null }
//   leadIds           — INTEGER[], máx. 200, não-vazio
//   responsibleUserId — UUID do responsável ou null (remover atribuição)
//
// Segurança:
//   • JWT validado via getUserFromToken (anon key + Authorization header)
//   • company_id resolvido a partir dos leads (não confiado do payload)
//   • Membership validado via assertMembership (Trilha 1 + Trilha 2 parent admin)
//   • RBAC: apenas super_admin / system_admin / admin / manager
//   • responsibleUserId validado na empresa (is_active = true) quando não null
//   • UPDATE restringe company_id e deleted_at IS NULL
//   • sync de chat não-fatal via bulk_sync_lead_responsible_to_conversations
// =====================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, assertMembership, jsonError } from '../lib/dashboard/auth.js'

const MAX_BULK_ASSIGN = 200
const ALLOWED_ROLES   = new Set(['super_admin', 'system_admin', 'admin', 'manager'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST') return jsonError(res, 405, 'Método não permitido')

  // ── 1. Autenticação ────────────────────────────────────────────────────────
  const token = extractToken(req.headers['authorization'] as string | undefined)
  if (!token) return jsonError(res, 401, 'Token de autenticação ausente')

  const { user, error: authError } = await getUserFromToken(token)
  if (authError || !user) return jsonError(res, 401, 'Sessão inválida ou expirada')

  // ── 2. Validar body ────────────────────────────────────────────────────────
  const { leadIds, responsibleUserId } = (req.body ?? {}) as {
    leadIds?:           unknown
    responsibleUserId?: unknown
  }

  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return jsonError(res, 400, 'leadIds deve ser um array não-vazio')
  }

  if (!leadIds.every((id) => Number.isInteger(id) && id > 0)) {
    return jsonError(res, 400, 'leadIds deve conter apenas inteiros positivos')
  }

  // responsibleUserId: null explícito é permitido (remoção); qualquer outro tipo não-string é inválido
  if (responsibleUserId !== null && responsibleUserId !== undefined && typeof responsibleUserId !== 'string') {
    return jsonError(res, 400, 'responsibleUserId inválido')
  }
  const resolvedResponsibleId: string | null =
    (responsibleUserId === null || responsibleUserId === undefined) ? null : responsibleUserId

  // ── 3. Dedup e limite ──────────────────────────────────────────────────────
  const deduped = Array.from(new Set(leadIds as number[]))

  if (deduped.length > MAX_BULK_ASSIGN) {
    return jsonError(res, 400, `Máximo de ${MAX_BULK_ASSIGN} leads por operação`)
  }

  const svc = getSupabaseAdmin()

  // ── 4. Resolver company_id e validar existência de todos os leads ──────────
  const { data: foundLeads, error: leadsError } = await svc
    .from('leads')
    .select('id, company_id')
    .in('id', deduped)
    .is('deleted_at', null)

  if (leadsError) {
    console.error('[bulk-assign] Erro ao buscar leads:', leadsError)
    return res.status(500).json({ ok: false, error: 'Erro ao buscar leads', details: leadsError.message })
  }

  // ── 5. Todos os leads informados devem existir ─────────────────────────────
  if (!foundLeads || foundLeads.length !== deduped.length) {
    return jsonError(res, 400, `${deduped.length - (foundLeads?.length ?? 0)} lead(s) não encontrado(s) ou já removido(s)`)
  }

  // ── 6. Todos os leads devem pertencer à mesma empresa ─────────────────────
  const companyIds = new Set(foundLeads.map((l) => (l as { id: number; company_id: string }).company_id))
  if (companyIds.size !== 1) {
    return jsonError(res, 400, 'Todos os leads devem pertencer à mesma empresa')
  }
  const companyId = [...companyIds][0]

  // ── 7. Membership + RBAC ──────────────────────────────────────────────────
  const member = await assertMembership(svc, user.id, companyId)
  if (!member) return jsonError(res, 403, 'Acesso negado a esta empresa')
  if (!ALLOWED_ROLES.has(member.role)) {
    return jsonError(res, 403, 'Permissão insuficiente para atribuição em lote')
  }

  // ── 8. Validar responsibleUserId na empresa (quando não null) ─────────────
  if (resolvedResponsibleId !== null) {
    const { data: targetUser } = await svc
      .from('company_users')
      .select('user_id')
      .eq('user_id', resolvedResponsibleId)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .maybeSingle()

    if (!targetUser) {
      return jsonError(res, 403, 'responsibleUserId não pertence à empresa ou está inativo')
    }
  }

  // ── 9. UPDATE leads ───────────────────────────────────────────────────────
  const { data: updatedRows, error: updateError } = await svc
    .from('leads')
    .update({ responsible_user_id: resolvedResponsibleId, updated_at: new Date().toISOString() })
    .in('id', deduped)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .select('id')

  if (updateError) {
    console.error('[bulk-assign] Erro ao atualizar leads:', updateError)
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar leads', details: updateError.message })
  }

  const updated = (updatedRows ?? []).length
  console.log(`[bulk-assign] user=${user.id} leads=${deduped.length} updated=${updated}`)

  // ── 10. Sync chat (não-fatal, apenas quando responsibleUserId não for null) ─
  let conversationsSynced = 0

  if (resolvedResponsibleId !== null) {
    try {
      const { data: syncCount, error: syncError } = await svc.rpc(
        'bulk_sync_lead_responsible_to_conversations',
        {
          p_lead_ids:            deduped,
          p_responsible_user_id: resolvedResponsibleId,
          p_company_id:          companyId,
        }
      )
      if (syncError) {
        console.warn(`[chat-sync] leads=${deduped.length} error=${syncError.message}`)
      } else {
        conversationsSynced = syncCount ?? 0
        console.log(`[chat-sync] leads=${deduped.length} updated_conversations=${conversationsSynced}`)
      }
    } catch (syncErr) {
      console.warn(`[chat-sync] leads=${deduped.length} exception=${(syncErr as Error)?.message}`)
    }
  }

  // ── 11. Resposta ──────────────────────────────────────────────────────────
  return res.status(200).json({
    ok:                  true,
    updated,
    requested:           deduped.length,
    conversations_synced: conversationsSynced,
  })
}
