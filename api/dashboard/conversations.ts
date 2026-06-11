// =====================================================
// GET /api/dashboard/conversations
//
// Lista paginada de conversas ativas no período.
// Fonte: chat_conversations filtrado por updated_at no período.
//
// Query params:
//   company_id  (obrigatório)
//   period / start_date / end_date
//   ai_state    (opcional — ex: 'active', 'paused', 'handoff')
//   user_id     (opcional — manager+ filtra por vendedor; seller/partner ignora e usa auth.uid)
//   page (default 1)
//   limit (default 20, max 20)
//
// RBAC:
//   seller/partner → filtra conversas dos leads com responsible_user_id = auth.uid()
//   manager+       → company-wide quando user_id ausente; filtra pelo alvo validado quando presente
//
// Batching:
//   O filtro por seller é feito em duas etapas:
//   1. Buscar lead_ids do seller (responsável)
//   2. Buscar conversas com .in('lead_id', [...]) em lotes de LEAD_BATCH_SIZE
//   Evita URL longa no PostgREST (limite ~8KB).
// =====================================================

import { getSupabaseAdmin }  from '../lib/automation/supabaseAdmin.js'
import { resolvePeriod }     from '../lib/dashboard/period.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

const MANAGER_ROLES    = new Set(['manager', 'admin', 'system_admin', 'super_admin'])
const LEAD_BATCH_SIZE  = 200

const DEFAULT_LIMIT = 20
const MAX_LIMIT     = 20

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'GET')     { jsonError(res, 405, 'Método não permitido'); return }

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
    // 2. Membership
    // ------------------------------------------------------------------
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // ------------------------------------------------------------------
    // 2b. Feature flag de visibilidade do chat por responsável
    //
    // Quando chat_visibility_by_assigned_to = true E callerRole = seller,
    // o filtro de conversas usa chat_conversations.assigned_to em vez de
    // leads.responsible_user_id — alinhando Dashboard ao comportamento do Chat.
    //
    // flag=false → caminho atual preservado (zero impacto em empresas existentes).
    // ------------------------------------------------------------------
    const callerRole = membership.role

    let chatVisibilityFlag = false
    {
      const { data: companyRow } = await svc
        .from('companies')
        .select('chat_visibility_by_assigned_to')
        .eq('id', companyId)
        .single()
      chatVisibilityFlag = companyRow?.chat_visibility_by_assigned_to === true
    }

    // useChatVisibility = true apenas para sellers na empresa com a flag ativa.
    // partner, manager, admin, system_admin, super_admin: caminho atual.
    const useChatVisibility = chatVisibilityFlag && callerRole === 'seller'

    // ------------------------------------------------------------------
    // 3. Período
    // ------------------------------------------------------------------
    const period     = typeof req.query.period     === 'string' ? req.query.period.trim()     : '30d'
    const start_date = typeof req.query.start_date === 'string' ? req.query.start_date.trim() : undefined
    const end_date   = typeof req.query.end_date   === 'string' ? req.query.end_date.trim()   : undefined

    let resolvedRange: { start: string; end: string }
    try { resolvedRange = resolvePeriod(period, start_date, end_date) }
    catch (e: any) { jsonError(res, 400, e.message ?? 'Período inválido'); return }

    // ------------------------------------------------------------------
    // 4. Filtro opcional de ai_state
    // ------------------------------------------------------------------
    const aiState = typeof req.query.ai_state === 'string' ? req.query.ai_state.trim() : null

    // ------------------------------------------------------------------
    // 5. Paginação
    // ------------------------------------------------------------------
    const page  = Math.max(1, parseInt(String(req.query.page  ?? '1'),  10) || 1)
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(String(req.query.limit ?? String(DEFAULT_LIMIT)), 10) || DEFAULT_LIMIT))
    const offset = (page - 1) * limit

    // ------------------------------------------------------------------
    // 6. RBAC — determina effectiveUserId por role
    // ------------------------------------------------------------------
    const rawUserId  = typeof req.query.user_id === 'string' ? req.query.user_id.trim() : null

    let effectiveUserId: string | null = null

    if (!MANAGER_ROLES.has(callerRole)) {
      // seller / partner: sempre força o próprio ID (ignora query.user_id)
      effectiveUserId = user.id
    } else if (rawUserId) {
      // manager+: se user_id enviado, valida que o alvo é membro ativo
      const targetMembership = await assertMembership(svc, rawUserId, companyId)
      if (!targetMembership) {
        jsonError(res, 403, 'Usuário selecionado não é membro ativo desta empresa'); return
      }
      effectiveUserId = rawUserId
    }
    // manager+ sem user_id → effectiveUserId = null → visão company-wide

    // ------------------------------------------------------------------
    // 7a. [NOVO] Caminho via assigned_to quando flag ativa + seller
    //
    //    Substitui a indireção leads→lead_ids→conversations.lead_id pelo
    //    filtro direto conversations.assigned_to = effectiveUserId.
    //
    //    Nota sobre assigned_to IS NULL:
    //      O Chat exibe conversas sem responsável como visíveis ao seller,
    //      pois representam filas disponíveis. O Dashboard, como visão de
    //      métricas pessoais, inclui apenas as conversas efetivamente
    //      atribuídas ao seller (assigned_to = effectiveUserId).
    //      Conversas sem responsável não são contabilizadas no desempenho
    //      individual do seller.
    //
    //    Performance: usa idx_chat_conv_company_assigned (company_id, assigned_to).
    // ------------------------------------------------------------------
    if (useChatVisibility && effectiveUserId !== null) {
      function applyBaseFiltersChat(q: any) {
        q = q.eq('company_id', companyId)
             .gte('updated_at', resolvedRange.start)
             .lte('updated_at', resolvedRange.end)
             .eq('assigned_to', effectiveUserId)
        if (aiState) q = q.eq('ai_state', aiState)
        return q
      }

      const [countResult, dataResult] = await Promise.all([
        applyBaseFiltersChat(
          svc.from('chat_conversations').select('id', { count: 'exact', head: true })
        ),
        applyBaseFiltersChat(
          svc.from('chat_conversations').select('id, contact_name, lead_id, ai_state, last_message_at, status, unread_count')
        )
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1),
      ])

      if (countResult.error) throw new Error(`count-chat: ${countResult.error.message}`)
      if (dataResult.error)  throw new Error(`data-chat: ${dataResult.error.message}`)

      const convs = dataResult.data ?? []
      const total = countResult.count ?? 0

      const leadIds = [...new Set(convs.map((c: any) => c.lead_id).filter(Boolean))] as string[]
      const leadMap = new Map<string, string>()
      if (leadIds.length > 0) {
        const { data: leads } = await svc.from('leads').select('id, name').in('id', leadIds)
        ;(leads ?? []).forEach((l: { id: string; name: string }) => leadMap.set(l.id, l.name))
      }

      return res.status(200).json({
        ok: true,
        data: convs.map((c: any) => ({
          conversation_id:  c.id,
          lead_id:          c.lead_id ?? null,
          lead_name:        c.contact_name || (c.lead_id ? leadMap.get(c.lead_id) : null) || '—',
          ai_state:         c.ai_state ?? 'unknown',
          last_message_at:  c.last_message_at ?? null,
          status:           c.status ?? '',
          unread_count:     c.unread_count ?? 0,
        })),
        meta: {
          page,
          limit,
          total,
          has_more:   offset + limit < total,
          period,
          start_date: resolvedRange.start,
          end_date:   resolvedRange.end,
          ai_state:   aiState ?? null,
          user_id:    effectiveUserId,
        },
      })
    }

    // ------------------------------------------------------------------
    // 7b. Caminho original: resolve lead_ids via responsible_user_id.
    //     Executado quando: flag=false, ou role != seller (partner, manager+).
    //     Inalterado — comportamento 100% preservado.
    //     Usa batching de LEAD_BATCH_SIZE para evitar URL longa no PostgREST.
    // ------------------------------------------------------------------
    let sellerLeadIds: string[] | null = null

    if (effectiveUserId !== null) {
      const { data: sellerLeads, error: leadsErr } = await svc
        .from('leads')
        .select('id')
        .eq('company_id', companyId)
        .eq('responsible_user_id', effectiveUserId)
        .is('deleted_at', null)

      if (leadsErr) throw new Error(`leads-seller: ${leadsErr.message}`)

      sellerLeadIds = (sellerLeads ?? []).map((l: { id: string }) => l.id)

      // Seller sem nenhum lead → retorna vazio imediatamente
      if (sellerLeadIds.length === 0) {
        return res.status(200).json({
          ok:   true,
          data: [],
          meta: {
            page,
            limit,
            total:      0,
            has_more:   false,
            period,
            start_date: resolvedRange.start,
            end_date:   resolvedRange.end,
            ai_state:   aiState ?? null,
            user_id:    effectiveUserId,
          },
        })
      }
    }

    // ------------------------------------------------------------------
    // 8. Count + dados — com batching quando sellerLeadIds definido
    //    Para evitar PostgREST URL limit, divide em lotes de LEAD_BATCH_SIZE
    //    e agrega os resultados em memória.
    // ------------------------------------------------------------------
    let countTotal   = 0
    let allConvs: Array<{
      id: string
      contact_name: string
      lead_id: string | null
      ai_state: string | null
      last_message_at: string | null
      status: string | null
      unread_count: number
    }> = []

    function applyBaseFilters(q: any) {
      q = q.eq('company_id', companyId)
           .gte('updated_at', resolvedRange.start)
           .lte('updated_at', resolvedRange.end)
      if (aiState) q = q.eq('ai_state', aiState)
      return q
    }

    if (sellerLeadIds === null) {
      // Visão company-wide: queries normais em paralelo
      const [countResult, dataResult] = await Promise.all([
        applyBaseFilters(
          svc.from('chat_conversations').select('id', { count: 'exact', head: true })
        ),
        applyBaseFilters(
          svc.from('chat_conversations').select('id, contact_name, lead_id, ai_state, last_message_at, status, unread_count')
        )
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .range(offset, offset + limit - 1),
      ])

      if (countResult.error) throw new Error(`count: ${countResult.error.message}`)
      if (dataResult.error)  throw new Error(`data: ${dataResult.error.message}`)

      countTotal = countResult.count ?? 0
      allConvs   = (dataResult.data ?? [])

    } else {
      // Escopo por seller: batching de IDs para evitar URL longa
      const batches: string[][] = []
      for (let i = 0; i < sellerLeadIds.length; i += LEAD_BATCH_SIZE) {
        batches.push(sellerLeadIds.slice(i, i + LEAD_BATCH_SIZE))
      }

      const batchedConvs: typeof allConvs = []

      for (const batch of batches) {
        const { data: batchData, error: batchErr } = await applyBaseFilters(
          svc.from('chat_conversations').select('id, contact_name, lead_id, ai_state, last_message_at, status, unread_count')
        ).in('lead_id', batch)

        if (batchErr) throw new Error(`convs-batch: ${batchErr.message}`)
        batchedConvs.push(...(batchData ?? []))
      }

      // Ordena e pagina em memória após agregação dos lotes
      batchedConvs.sort((a, b) => {
        const ta = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
        const tb = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
        return tb - ta
      })

      countTotal = batchedConvs.length
      allConvs   = batchedConvs.slice(offset, offset + limit)
    }

    const convs = allConvs
    const total  = countTotal

    // ------------------------------------------------------------------
    // 9. Enriquecer com lead name quando contact_name ausente
    // ------------------------------------------------------------------
    const leadIds = [...new Set(convs.map(c => c.lead_id).filter(Boolean))] as string[]
    const leadMap = new Map<string, string>()

    if (leadIds.length > 0) {
      const { data: leads } = await svc
        .from('leads')
        .select('id, name')
        .in('id', leadIds)
      ;(leads ?? []).forEach((l: { id: string; name: string }) => leadMap.set(l.id, l.name))
    }

    return res.status(200).json({
      ok: true,
      data: convs.map(c => ({
        conversation_id:  c.id,
        lead_id:          c.lead_id ?? null,
        lead_name:        c.contact_name || (c.lead_id ? leadMap.get(c.lead_id) : null) || '—',
        ai_state:         c.ai_state ?? 'unknown',
        last_message_at:  c.last_message_at ?? null,
        status:           c.status ?? '',
        unread_count:     c.unread_count ?? 0,
      })),
      meta: {
        page,
        limit,
        total,
        has_more:   offset + limit < total,
        period,
        start_date: resolvedRange.start,
        end_date:   resolvedRange.end,
        ai_state:   aiState ?? null,
        user_id:    effectiveUserId ?? null,
      },
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[dashboard/conversations] Erro:', msg)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
