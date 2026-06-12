// =====================================================
// POST /api/leads/sync-chat-assignment
//
// Sincroniza leads.responsible_user_id → chat_conversations.assigned_to
// para um lead específico após atribuição manual de responsável.
//
// Body: { leadId: number, responsibleUserId: string | null }
//   leadId            — INTEGER, lead alvo da sincronização
//   responsibleUserId — UUID do responsável (null encerra sem sync)
//
// Segurança:
//   • JWT validado via getUserFromToken (anon key + Authorization header)
//   • company_id resolvido a partir do lead (não confiado do payload)
//   • Membership validado via assertMembership (Trilha 1 + Trilha 2 parent admin)
//   • RBAC: apenas super_admin / system_admin / admin / manager
//   • responsibleUserId validado na empresa (is_active = true) quando não null
//   • sync via service_role — não-fatal
// =====================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, assertMembership, jsonError } from '../lib/dashboard/auth.js'

const ALLOWED_ROLES = new Set(['super_admin', 'system_admin', 'admin', 'manager'])

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
  const { leadId, responsibleUserId } = (req.body ?? {}) as {
    leadId?:           unknown
    responsibleUserId?: unknown
  }

  if (!leadId || !Number.isInteger(leadId) || (leadId as number) <= 0) {
    return jsonError(res, 400, 'leadId inválido ou ausente')
  }

  // responsibleUserId: null é permitido (sem sync); string não-vazia é UUID esperado
  if (responsibleUserId !== null && responsibleUserId !== undefined && typeof responsibleUserId !== 'string') {
    return jsonError(res, 400, 'responsibleUserId inválido')
  }
  const resolvedResponsibleId: string | null =
    responsibleUserId === null || responsibleUserId === undefined || (responsibleUserId as string).trim() === ''
      ? null
      : (responsibleUserId as string)

  const svc = getSupabaseAdmin()

  // ── 3. Resolver company_id a partir do lead ────────────────────────────────
  const { data: lead, error: leadError } = await svc
    .from('leads')
    .select('id, company_id')
    .eq('id', leadId as number)
    .is('deleted_at', null)
    .maybeSingle()

  if (leadError || !lead) {
    return jsonError(res, 404, 'Lead não encontrado')
  }

  const companyId = (lead as { id: number; company_id: string }).company_id

  // ── 4. Membership + RBAC ──────────────────────────────────────────────────
  const member = await assertMembership(svc, user.id, companyId)
  if (!member) return jsonError(res, 403, 'Acesso negado a esta empresa')
  if (!ALLOWED_ROLES.has(member.role)) {
    return jsonError(res, 403, 'Permissão insuficiente para sincronização de chat')
  }

  // ── 5. Validar responsibleUserId na empresa (quando não null) ─────────────
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

  // ── 6. Sync — sempre executado (null = limpar assigned_to) ─────────────────
  // Helper v2 aceita null: limpa assigned_to em todas as conversas do lead
  let conversationsSynced = 0

  try {
    const { data: syncCount, error: syncError } = await svc.rpc(
      'sync_lead_responsible_to_conversations',
      {
        p_lead_id:             leadId as number,
        p_responsible_user_id: resolvedResponsibleId,  // null = clear
      }
    )
    if (syncError) {
      console.warn(`[chat-sync] lead=${leadId} responsible=${resolvedResponsibleId ?? 'NULL'} error=${syncError.message}`)
    } else {
      conversationsSynced = syncCount ?? 0
      console.log(`[chat-sync] lead=${leadId} responsible=${resolvedResponsibleId ?? 'NULL'} updated_conversations=${conversationsSynced}`)
    }
  } catch (syncErr) {
    console.warn(`[chat-sync] lead=${leadId} responsible=${resolvedResponsibleId ?? 'NULL'} exception=${(syncErr as Error)?.message}`)
  }

  // ── 7. Resposta ──────────────────────────────────────────────────────────
  return res.status(200).json({ ok: true, conversations_synced: conversationsSynced })
}
