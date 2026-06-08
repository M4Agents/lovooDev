// =====================================================
// POST /api/leads/merge-batch
//
// Mescla múltiplos pares de leads duplicados de forma sequencial.
//
// Body: { pairs: [{ sourceId, targetId, notificationId? }], strategy }
//   pairs          — array de pares, máximo MAX_BULK_MERGE = 20
//   strategy       — 'keep_existing' | 'keep_new' | 'merge_fields'
//
// Segurança (por par, independente):
//   • JWT validado via getUserFromToken
//   • company_id resolvido a partir do sourceLead (não confiado do payload)
//   • Membership validado (Trilha 1 + Trilha 2 parent admin)
//   • RBAC: admin/system_admin/super_admin — mescla qualquer par
//   • Outros roles (partner, manager, seller) — apenas se ambos os leads
//     têm responsible_user_id = user.id
//   • Falha em um par NÃO aborta o lote (resultado parcial suportado)
//   • Processamento SEQUENCIAL — sem Promise.all ou paralelismo
//
// Lacuna herdada:
//   • notificationId não é validado contra sourceId/targetId
//     (mesmo comportamento do endpoint individual /api/leads/merge)
// =====================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, jsonError } from '../lib/dashboard/auth.js'

const MAX_BULK_MERGE = 20
const VALID_STRATEGIES = ['keep_existing', 'keep_new', 'merge_fields'] as const
const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

type Strategy = typeof VALID_STRATEGIES[number]

interface MergePair {
  sourceId: unknown
  targetId: unknown
  notificationId?: unknown
}

interface PairResult {
  sourceId: number
  targetId: number
  notificationId: string | null
  ok: boolean
  resultLeadId?: number
  error?: string
}

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
  const { pairs, strategy } = (req.body ?? {}) as { pairs?: unknown; strategy?: unknown }

  if (!pairs || !Array.isArray(pairs) || pairs.length === 0) {
    return jsonError(res, 400, 'pairs é obrigatório e deve ser um array não vazio')
  }

  if (pairs.length > MAX_BULK_MERGE) {
    return jsonError(res, 400, `Máximo de ${MAX_BULK_MERGE} pares por operação`)
  }

  if (!strategy || !VALID_STRATEGIES.includes(strategy as Strategy)) {
    return jsonError(res, 400, 'strategy inválida. Use: keep_existing, keep_new ou merge_fields')
  }

  const svc = getSupabaseAdmin()
  const results: PairResult[] = []
  let succeeded = 0
  let failed = 0

  // ── 3. Processamento sequencial — cada par é independente ─────────────────
  for (const pair of pairs as MergePair[]) {
    const sourceId = pair?.sourceId
    const targetId = pair?.targetId
    const notificationId = pair?.notificationId ?? null

    // Validação mínima de cada par
    if (!sourceId || !targetId) {
      results.push({
        sourceId: Number(sourceId) || 0,
        targetId: Number(targetId) || 0,
        notificationId: notificationId ? String(notificationId) : null,
        ok: false,
        error: 'sourceId e targetId são obrigatórios por par',
      })
      failed++
      continue
    }

    try {
      // ── 3a. Resolver source lead e companyId ─────────────────────────────
      const { data: sourceLead, error: srcErr } = await svc
        .from('leads')
        .select('id, company_id, responsible_user_id')
        .eq('id', Number(sourceId))
        .is('deleted_at', null)
        .maybeSingle()

      if (srcErr || !sourceLead) {
        results.push({
          sourceId: Number(sourceId),
          targetId: Number(targetId),
          notificationId: notificationId ? String(notificationId) : null,
          ok: false,
          error: 'Lead de origem não encontrado',
        })
        failed++
        continue
      }

      const companyId = (sourceLead as { company_id: string }).company_id

      // ── 3b. Resolver target lead ──────────────────────────────────────────
      const { data: targetLead, error: tgtErr } = await svc
        .from('leads')
        .select('id, company_id, responsible_user_id')
        .eq('id', Number(targetId))
        .is('deleted_at', null)
        .maybeSingle()

      if (tgtErr || !targetLead) {
        results.push({
          sourceId: Number(sourceId),
          targetId: Number(targetId),
          notificationId: notificationId ? String(notificationId) : null,
          ok: false,
          error: 'Lead de destino não encontrado',
        })
        failed++
        continue
      }

      const src = sourceLead as { id: number; company_id: string; responsible_user_id: string | null }
      const tgt = targetLead as { id: number; company_id: string; responsible_user_id: string | null }

      // ── 3c. Membership — Trilha 1 ──────────────────────────────────────────
      const { data: member } = await svc
        .from('company_users')
        .select('role')
        .eq('user_id', user.id)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .maybeSingle()

      let memberRole: string | null = (member as { role?: string } | null)?.role ?? null

      // ── 3d. Membership — Trilha 2 (super_admin/system_admin da empresa pai) ─
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

      if (!memberRole) {
        results.push({
          sourceId: src.id,
          targetId: tgt.id,
          notificationId: notificationId ? String(notificationId) : null,
          ok: false,
          error: 'Acesso negado a esta empresa',
        })
        failed++
        continue
      }

      // ── 3e. RBAC — roles não-admin só mesclam próprios leads ──────────────
      if (!ADMIN_ROLES.has(memberRole)) {
        const bothAssigned =
          src.responsible_user_id === user.id &&
          tgt.responsible_user_id === user.id

        if (!bothAssigned) {
          results.push({
            sourceId: src.id,
            targetId: tgt.id,
            notificationId: notificationId ? String(notificationId) : null,
            ok: false,
            error: 'Você só pode mesclar leads atribuídos a você',
          })
          failed++
          continue
        }
      }

      // ── 3f. Executar RPC merge_leads_webhook ──────────────────────────────
      const { data: rpcResult, error: rpcErr } = await svc.rpc('merge_leads_webhook', {
        p_source_id:       src.id,
        p_target_id:       tgt.id,
        p_strategy:        strategy as string,
        p_notification_id: notificationId ? String(notificationId) : null,
        p_user_id:         user.id,
      })

      if (rpcErr) {
        results.push({
          sourceId: src.id,
          targetId: tgt.id,
          notificationId: notificationId ? String(notificationId) : null,
          ok: false,
          error: rpcErr.message ?? 'Erro ao executar mesclagem',
        })
        failed++
        continue
      }

      const rpc = rpcResult as { success?: boolean; error?: string; result_lead_id?: number } | null

      if (!rpc?.success) {
        results.push({
          sourceId: src.id,
          targetId: tgt.id,
          notificationId: notificationId ? String(notificationId) : null,
          ok: false,
          error: rpc?.error ?? 'Falha na mesclagem',
        })
        failed++
        continue
      }

      results.push({
        sourceId: src.id,
        targetId: tgt.id,
        notificationId: notificationId ? String(notificationId) : null,
        ok: true,
        resultLeadId: rpc.result_lead_id,
      })
      succeeded++

    } catch (err) {
      const error = err as Error
      results.push({
        sourceId: Number(sourceId) || 0,
        targetId: Number(targetId) || 0,
        notificationId: notificationId ? String(notificationId) : null,
        ok: false,
        error: error.message ?? 'Erro inesperado',
      })
      failed++
    }
  }

  // ── 4. Retornar resumo ────────────────────────────────────────────────────
  return res.status(200).json({
    ok: true,
    total: pairs.length,
    succeeded,
    failed,
    results,
  })
}
