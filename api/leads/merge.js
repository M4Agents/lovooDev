// =====================================================
// POST /api/leads/merge
//
// Mescla dois leads duplicados via RPC merge_leads_webhook.
//
// Body: { sourceId, targetId, strategy, notificationId? }
//   sourceId      — INTEGER, lead de origem (será descartado)
//   targetId      — INTEGER, lead de destino (sobrevivente na maioria das estratégias)
//   strategy      — 'keep_existing' | 'keep_new' | 'merge_fields'
//   notificationId — UUID opcional da duplicate_notification
//
// Segurança:
//   • JWT validado via getUserFromToken (anon key + Authorization header)
//   • Membership validado via assertMembership (Trilha 1 + Trilha 2 parent admin)
//   • company_id resolvido a partir do lead (não confiado do payload)
//   • RBAC: admin / system_admin / super_admin apenas
//   • service_role para chamar a RPC (bypass de RLS necessário para SECURITY DEFINER)
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, jsonError } from '../lib/dashboard/auth.ts'

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') { res.status(200).end(); return }
  if (req.method !== 'POST') return jsonError(res, 405, 'Método não permitido')

  // ── 1. Autenticação ────────────────────────────────────────────────────────
  const token = extractToken(req.headers['authorization'])
  if (!token) return jsonError(res, 401, 'Token de autenticação ausente')

  const { user, error: authError } = await getUserFromToken(token)
  if (authError || !user) return jsonError(res, 401, 'Sessão inválida ou expirada')

  // ── 2. Validar body ────────────────────────────────────────────────────────
  const { sourceId, targetId, strategy, notificationId } = req.body ?? {}

  if (!sourceId || !targetId || !strategy) {
    return jsonError(res, 400, 'sourceId, targetId e strategy são obrigatórios')
  }

  const VALID_STRATEGIES = ['keep_existing', 'keep_new', 'merge_fields']
  if (!VALID_STRATEGIES.includes(strategy)) {
    return jsonError(res, 400, 'Estratégia inválida')
  }

  // ── 3. Resolver company_id a partir do lead (não confiar no payload) ───────
  const svc = getSupabaseAdmin()

  const { data: sourceLead, error: leadError } = await svc
    .from('leads')
    .select('id, company_id')
    .eq('id', sourceId)
    .is('deleted_at', null)
    .maybeSingle()

  if (leadError || !sourceLead) {
    return jsonError(res, 404, 'Lead de origem não encontrado')
  }

  const companyId = sourceLead.company_id

  // ── 4. Autorização: membership + RBAC ─────────────────────────────────────
  const { data: member } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()

  let memberRole = member?.role ?? null

  // Trilha 2: super_admin / system_admin da empresa pai
  if (!memberRole) {
    const { data: company } = await svc
      .from('companies')
      .select('parent_company_id')
      .eq('id', companyId)
      .maybeSingle()

    if (company?.parent_company_id) {
      const { data: parentMember } = await svc
        .from('company_users')
        .select('role')
        .eq('user_id', user.id)
        .eq('company_id', company.parent_company_id)
        .eq('is_active', true)
        .in('role', ['super_admin', 'system_admin'])
        .maybeSingle()

      memberRole = parentMember?.role ?? null
    }
  }

  if (!memberRole) return jsonError(res, 403, 'Acesso negado a esta empresa')
  if (!ADMIN_ROLES.has(memberRole)) return jsonError(res, 403, 'Permissão insuficiente para mesclar leads')

  // ── 5. Executar RPC ────────────────────────────────────────────────────────
  try {
    const { data: result, error: rpcError } = await svc
      .rpc('merge_leads_webhook', {
        p_source_id:       Number(sourceId),
        p_target_id:       Number(targetId),
        p_strategy:        strategy,
        p_notification_id: notificationId ?? null,
        p_user_id:         user.id,
      })

    if (rpcError) {
      console.error('[merge] RPC error:', rpcError)
      return res.status(500).json({ ok: false, error: 'Erro ao executar mesclagem', details: rpcError.message })
    }

    if (!result?.success) {
      console.error('[merge] RPC returned failure:', result)
      return res.status(400).json({ ok: false, error: result?.error ?? 'Falha na mesclagem de leads' })
    }

    return res.status(200).json({
      ok:          true,
      message:     result.message,
      resultLeadId: result.result_lead_id,
      strategy:    result.strategy,
      mergedData:  result.merged_data,
    })
  } catch (err) {
    console.error('[merge] Unexpected error:', err)
    return res.status(500).json({ ok: false, error: 'Erro interno do servidor', details: err.message })
  }
}
