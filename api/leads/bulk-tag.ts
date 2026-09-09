// =====================================================
// POST /api/leads/bulk-tag
//
// Atribui tags em lote para múltiplos leads (operação ADITIVA).
// Nunca remove tags existentes — apenas adiciona as novas.
//
// Body: { leadIds: number[], tagIds: string[] }
//   leadIds — INTEGER[], máx. 200 brutos, não-vazio
//   tagIds  — UUID[], máx. 50 brutos, não-vazio
//
// Segurança:
//   • JWT validado via getUserFromToken (anon key + Authorization header)
//   • company_id resolvido a partir dos leads (não confiado do payload)
//   • Todos os leads devem existir, não estar deletados e pertencer à mesma empresa
//   • Membership validado via assertMembership (Trilha 1 + Trilha 2 parent admin)
//   • RBAC: super_admin / system_admin / admin / manager
//   • Todas as tags devem existir, pertencer à empresa e estar ativas
//   • Upsert único com ignoreDuplicates — atomicidade garantida pelo PostgreSQL
//   • service_role usado somente no backend após todas as validações
// =====================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import { extractToken, getUserFromToken, assertMembership, jsonError } from '../lib/dashboard/auth.js'

const MAX_LEAD_IDS = 200
const MAX_TAG_IDS  = 50

// Espelha canBulkTagLeads de useAccessControl.ts:
//   { 'super_admin', 'system_admin', 'admin', 'manager' }
// partner / seller: bloqueados.
const ALLOWED_ROLES = new Set(['super_admin', 'system_admin', 'admin', 'manager'])

// UUID v4 simples — suficiente para rejeitar lixo antes de ir ao banco
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  // ── 2. Validar presença e tipo dos arrays ──────────────────────────────────
  const { leadIds, tagIds } = (req.body ?? {}) as { leadIds?: unknown; tagIds?: unknown }

  if (!Array.isArray(leadIds)) return jsonError(res, 400, 'leadIds deve ser um array')
  if (!Array.isArray(tagIds))  return jsonError(res, 400, 'tagIds deve ser um array')

  // ── 3. Validar arrays não-vazios ───────────────────────────────────────────
  if (leadIds.length === 0) return jsonError(res, 400, 'leadIds não pode ser vazio')
  if (tagIds.length === 0)  return jsonError(res, 400, 'tagIds não pode ser vazio')

  // ── 4. Validar limites BRUTOS (antes de deduplicar) ───────────────────────
  if (leadIds.length > MAX_LEAD_IDS) {
    return jsonError(res, 400, `leadIds excede o limite de ${MAX_LEAD_IDS} itens`)
  }
  if (tagIds.length > MAX_TAG_IDS) {
    return jsonError(res, 400, `tagIds excede o limite de ${MAX_TAG_IDS} itens`)
  }

  // ── 5. Validar tipos dos itens ─────────────────────────────────────────────
  if (!leadIds.every((id) => Number.isInteger(id) && (id as number) > 0)) {
    return jsonError(res, 400, 'leadIds deve conter apenas inteiros positivos')
  }
  if (!tagIds.every((id) => typeof id === 'string' && UUID_RE.test(id as string))) {
    return jsonError(res, 400, 'tagIds deve conter apenas UUIDs válidos')
  }

  // ── 6. Deduplicar ──────────────────────────────────────────────────────────
  const dedupedLeadIds = Array.from(new Set(leadIds as number[]))
  const dedupedTagIds  = Array.from(new Set(tagIds as string[]))

  const svc = getSupabaseAdmin()

  // ── 7. Buscar leads — validar existência e single company ──────────────────
  const { data: foundLeads, error: leadsError } = await svc
    .from('leads')
    .select('id, company_id')
    .in('id', dedupedLeadIds)
    .is('deleted_at', null)

  if (leadsError) {
    console.error('[bulk-tag] Erro ao buscar leads:', leadsError)
    return res.status(500).json({ ok: false, error: 'Erro ao buscar leads' })
  }

  if (!foundLeads || foundLeads.length !== dedupedLeadIds.length) {
    return jsonError(
      res,
      400,
      `${dedupedLeadIds.length - (foundLeads?.length ?? 0)} lead(s) não encontrado(s) ou já removido(s)`,
    )
  }

  const companyIds = new Set(foundLeads.map((l) => (l as { id: number; company_id: string }).company_id))
  if (companyIds.size !== 1) {
    return jsonError(res, 400, 'Todos os leads devem pertencer à mesma empresa')
  }
  const companyId = [...companyIds][0]

  // ── 8. Membership + RBAC ──────────────────────────────────────────────────
  const member = await assertMembership(svc, user.id, companyId)
  if (!member) return jsonError(res, 403, 'Acesso negado a esta empresa')
  if (!ALLOWED_ROLES.has(member.role)) {
    return jsonError(res, 403, 'Permissão insuficiente para atribuição de tags em lote')
  }

  // ── 9. Validar tags — existência, company e is_active ─────────────────────
  const { data: foundTags, error: tagsError } = await svc
    .from('lead_tags')
    .select('id')
    .in('id', dedupedTagIds)
    .eq('company_id', companyId)
    .eq('is_active', true)

  if (tagsError) {
    console.error('[bulk-tag] Erro ao buscar tags:', tagsError)
    return res.status(500).json({ ok: false, error: 'Erro ao buscar tags' })
  }

  if (!foundTags || foundTags.length !== dedupedTagIds.length) {
    return jsonError(
      res,
      400,
      'Uma ou mais tags não foram encontradas, pertencem a outra empresa ou estão inativas',
    )
  }

  // ── 10. Montar pares e inserir (aditivo — ignoreDuplicates) ───────────────
  // Produto cartesiano leadIds × tagIds — máx. 200 × 50 = 10.000 pares
  const pairs = dedupedLeadIds.flatMap((leadId) =>
    dedupedTagIds.map((tagId) => ({ lead_id: leadId, tag_id: tagId })),
  )

  const { error: upsertError } = await svc
    .from('lead_tag_assignments')
    .upsert(pairs, { onConflict: 'lead_id,tag_id', ignoreDuplicates: true })

  if (upsertError) {
    console.error('[bulk-tag] Erro ao inserir tags:', upsertError)
    return res.status(500).json({ ok: false, error: 'Erro ao atribuir tags' })
  }

  console.log(
    `[bulk-tag] user=${user.id} company=${companyId} leads=${dedupedLeadIds.length} tags=${dedupedTagIds.length} pairs=${pairs.length}`,
  )

  // ── 11. Resposta ──────────────────────────────────────────────────────────
  // ignoreDuplicates=true não retorna count de linhas afetadas de forma
  // confiável pelo cliente Supabase JS — reportamos apenas o que sabemos.
  return res.status(200).json({
    ok:             true,
    requestedLeads: dedupedLeadIds.length,
    requestedTags:  dedupedTagIds.length,
  })
}
