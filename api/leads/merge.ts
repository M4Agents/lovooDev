// =====================================================
// POST /api/leads/merge
//
// Mescla dois leads duplicados via RPC merge_leads_webhook.
//
// Body: { sourceId, targetId, strategy, notificationId? }
//   sourceId       — INTEGER, lead de origem (será descartado)
//   targetId       — INTEGER, lead de destino (sobrevivente na maioria das estratégias)
//   strategy       — 'keep_existing' | 'keep_new' | 'merge_fields'
//   notificationId — UUID opcional da duplicate_notification
//
// Segurança:
//   • JWT validado via getUserFromToken (anon key + Authorization header)
//   • Membership validado via assertMembership (Trilha 1 + Trilha 2 parent admin)
//   • company_id resolvido a partir do lead (não confiado do payload)
//   • RBAC: admin / system_admin / super_admin apenas
//   • service_role para chamar a RPC (bypass de RLS necessário para SECURITY DEFINER)
// =====================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, jsonError } from '../lib/dashboard/auth.js'

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

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
  const { sourceId, targetId, strategy, notificationId } = (req.body ?? {}) as {
    sourceId?: unknown
    targetId?: unknown
    strategy?: unknown
    notificationId?: unknown
  }

  if (!sourceId || !targetId || !strategy) {
    return jsonError(res, 400, 'sourceId, targetId e strategy são obrigatórios')
  }

  const VALID_STRATEGIES = ['keep_existing', 'keep_new', 'merge_fields']
  if (!VALID_STRATEGIES.includes(strategy as string)) {
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

  const companyId = sourceLead.company_id as string

  // ── 4. Autorização: membership + RBAC ─────────────────────────────────────
  const { data: member } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()

  let memberRole: string | null = (member as { role?: string } | null)?.role ?? null

  // Trilha 2: super_admin / system_admin da empresa pai
  if (!memberRole) {
    const { data: company } = await svc
      .from('companies')
      .select('parent_company_id')
      .eq('id', companyId)
      .maybeSingle()

    const parentCompanyId = (company as { parent_company_id?: string } | null)?.parent_company_id

    if (parentCompanyId) {
      const { data: parentMember } = await svc
        .from('company_users')
        .select('role')
        .eq('user_id', user.id)
        .eq('company_id', parentCompanyId)
        .eq('is_active', true)
        .in('role', ['super_admin', 'system_admin'])
        .maybeSingle()

      memberRole = (parentMember as { role?: string } | null)?.role ?? null
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
        p_strategy:        strategy as string,
        p_notification_id: (notificationId as string | undefined) ?? null,
        p_user_id:         user.id,
      })

    if (rpcError) {
      console.error('[merge] RPC error:', rpcError)
      // #region agent log
      fetch('http://127.0.0.1:7720/ingest/d2f8cac3-ea7e-46a2-a261-0c2f15b0b14c',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'da6971'},body:JSON.stringify({sessionId:'da6971',location:'merge.ts:rpcError',message:'RPC merge_leads_webhook falhou',data:{message:rpcError.message,code:(rpcError as {code?:string}).code,details:(rpcError as {details?:string}).details,hint:(rpcError as {hint?:string}).hint,sourceId:Number(sourceId),targetId:Number(targetId),strategy,notificationId:notificationId??null,userId:user.id,companyId},hypothesisId:'H1',timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return res.status(500).json({ ok: false, error: 'Erro ao executar mesclagem', details: rpcError.message })
    }

    const rpcResult = result as { success?: boolean; error?: string; message?: string; result_lead_id?: number; strategy?: string; merged_data?: unknown } | null

    if (!rpcResult?.success) {
      console.error('[merge] RPC returned failure:', rpcResult)
      return res.status(400).json({ ok: false, error: rpcResult?.error ?? 'Falha na mesclagem de leads' })
    }

    return res.status(200).json({
      ok:           true,
      message:      rpcResult.message,
      resultLeadId: rpcResult.result_lead_id,
      strategy:     rpcResult.strategy,
      mergedData:   rpcResult.merged_data,
    })
  } catch (err) {
    const error = err as Error
    console.error('[merge] Unexpected error:', error)
    return res.status(500).json({ ok: false, error: 'Erro interno do servidor', details: error.message })
  }
}
