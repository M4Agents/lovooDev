// =====================================================
// POST /api/dashboard/alert-dismissals
//
// Registra a dispensa de um alerta do dashboard.
// A dispensa é vinculada à mensagem específica (last_inbound_message_id)
// que gerou o alerta SLA — não à conversa inteira.
// Se uma nova inbound chegar, o id muda e o alerta reaparece.
//
// Body JSON:
//   company_id              (UUID, obrigatório)
//   entity_type             'conversation' | 'opportunity'
//   entity_id               (UUID, obrigatório)
//   alert_kind              'sla_unanswered' | 'stalled_opportunity'
//   last_inbound_message_id (UUID, obrigatório se sla_unanswered; omitir/null se stalled_opportunity)
//
// Segurança:
//   • dismissed_by é sempre user.id do JWT — nunca aceito do payload
//   • Entidade validada no banco via service_role antes do INSERT
//   • Para sla_unanswered: valida que a mensagem é a última inbound real da conversa
//   • ON CONFLICT DO NOTHING garante idempotência
//   • Se conflito: retorna o registro existente com 200 (comportamento idempotente)
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { logDashboardError } from '../lib/dashboard/observability.js'

const VALID_ENTITY_TYPES = new Set(['conversation', 'opportunity'])
const VALID_ALERT_KINDS  = new Set(['sla_unanswered', 'stalled_opportunity'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'POST')    { jsonError(res, 405, 'Método não permitido'); return }

  try {
    // --------------------------------------------------
    // 1. Autenticação
    // --------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // --------------------------------------------------
    // 2. Validação do body
    // --------------------------------------------------
    const body = req.body ?? {}

    const companyId  = typeof body.company_id === 'string' ? body.company_id.trim() : ''
    const entityType = typeof body.entity_type === 'string' ? body.entity_type.trim() : ''
    const entityId   = typeof body.entity_id === 'string' ? body.entity_id.trim() : ''
    const alertKind  = typeof body.alert_kind === 'string' ? body.alert_kind.trim() : ''
    const lastInboundId: string | null =
      typeof body.last_inbound_message_id === 'string'
        ? body.last_inbound_message_id.trim()
        : null

    if (!isUUID(companyId))  { jsonError(res, 400, 'company_id inválido'); return }
    if (!isUUID(entityId))   { jsonError(res, 400, 'entity_id inválido'); return }

    if (!VALID_ENTITY_TYPES.has(entityType)) {
      jsonError(res, 400, 'entity_type deve ser "conversation" ou "opportunity"'); return
    }
    if (!VALID_ALERT_KINDS.has(alertKind)) {
      jsonError(res, 400, 'alert_kind deve ser "sla_unanswered" ou "stalled_opportunity"'); return
    }

    // Consistência entre alert_kind e last_inbound_message_id
    if (alertKind === 'sla_unanswered' && !isUUID(lastInboundId)) {
      jsonError(res, 400, 'last_inbound_message_id é obrigatório para sla_unanswered'); return
    }
    if (alertKind === 'stalled_opportunity' && lastInboundId !== null) {
      jsonError(res, 400, 'last_inbound_message_id deve ser nulo para stalled_opportunity'); return
    }

    // Consistência entre entity_type e alert_kind
    if (alertKind === 'sla_unanswered' && entityType !== 'conversation') {
      jsonError(res, 400, 'sla_unanswered requer entity_type = "conversation"'); return
    }
    if (alertKind === 'stalled_opportunity' && entityType !== 'opportunity') {
      jsonError(res, 400, 'stalled_opportunity requer entity_type = "opportunity"'); return
    }

    // --------------------------------------------------
    // 3. Membership — usuário ativo na empresa
    // --------------------------------------------------
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // --------------------------------------------------
    // 4. Validar que a entidade pertence à empresa
    //    service_role garante acesso mesmo com RLS —
    //    a barreira real é o filtro explícito de company_id.
    // --------------------------------------------------
    if (entityType === 'conversation') {
      const { data: conv } = await svc
        .from('chat_conversations')
        .select('id')
        .eq('id', entityId)
        .eq('company_id', companyId)
        .maybeSingle()

      if (!conv) {
        jsonError(res, 404, 'Conversa não encontrada nesta empresa'); return
      }
    } else {
      const { data: opp } = await svc
        .from('opportunities')
        .select('id')
        .eq('id', entityId)
        .eq('company_id', companyId)
        .maybeSingle()

      if (!opp) {
        jsonError(res, 404, 'Oportunidade não encontrada nesta empresa'); return
      }
    }

    // --------------------------------------------------
    // 5. [Somente sla_unanswered] Validar que a mensagem é
    //    a última inbound real da conversa — mesma lógica
    //    que as RPCs usam no DISTINCT ON ... ORDER BY created_at DESC.
    //
    //    A query confirma em um único round-trip:
    //      • id = last_inbound_message_id
    //      • conversation_id = entity_id
    //      • direction = 'inbound'
    //      • não existe inbound mais recente na mesma conversa
    //
    //    Dispensar uma mensagem antiga causaria inconsistência:
    //    a RPC enxerga uma mensagem diferente como "última inbound"
    //    e o alerta continuaria aparecendo mesmo após a dispensa.
    // --------------------------------------------------
    if (alertKind === 'sla_unanswered' && isUUID(lastInboundId)) {
      const { data: msgCheck, error: msgError } = await svc
        .from('chat_messages')
        .select('id, created_at, conversation_id')
        .eq('id', lastInboundId)
        .eq('conversation_id', entityId)
        .eq('direction', 'inbound')
        .maybeSingle()

      if (msgError || !msgCheck) {
        jsonError(res, 422, 'Mensagem não encontrada ou não pertence à conversa'); return
      }

      // Confirma que não existe inbound posterior na mesma conversa
      const { data: newerMsg } = await svc
        .from('chat_messages')
        .select('id')
        .eq('conversation_id', entityId)
        .eq('direction', 'inbound')
        .gt('created_at', msgCheck.created_at)
        .limit(1)
        .maybeSingle()

      if (newerMsg) {
        jsonError(
          res, 422,
          'Existe uma inbound mais recente nesta conversa: o alerta seria reexibido imediatamente',
        ); return
      }
    }

    // --------------------------------------------------
    // 6. INSERT com idempotência via ON CONFLICT DO NOTHING
    //    Os índices únicos parciais são:
    //      uq_dismissal_sla_per_user (company_id, dismissed_by, last_inbound_message_id)
    //        WHERE entity_type = 'conversation'
    //      uq_dismissal_opp_per_user (company_id, dismissed_by, entity_id)
    //        WHERE entity_type = 'opportunity'
    //    A cláusula onConflict do Supabase JS mapeia para
    //    ON CONFLICT (cols) WHERE predicate DO NOTHING quando
    //    ignoreDuplicates = true + o índice parcial existe.
    // --------------------------------------------------
    const insertPayload = {
      company_id:               companyId,
      dismissed_by:             user.id,   // SEMPRE do JWT, nunca do payload
      entity_type:              entityType,
      entity_id:                entityId,
      alert_kind:               alertKind,
      last_inbound_message_id:  lastInboundId ?? undefined,
    }

    const conflictColumns =
      alertKind === 'sla_unanswered'
        ? 'company_id,dismissed_by,last_inbound_message_id'
        : 'company_id,dismissed_by,entity_id'

    const { data: inserted, error: insertError } = await svc
      .from('dashboard_alert_dismissals')
      .insert(insertPayload)
      .onConflict(conflictColumns)
      .ignoreDuplicates()
      .select('id, dismissed_at')
      .maybeSingle()

    if (insertError) {
      logDashboardError('dashboard.alert-dismissals.post', insertError, { companyId })
      jsonError(res, 500, 'Erro ao registrar dispensa'); return
    }

    // --------------------------------------------------
    // 7. Idempotência: se INSERT não inseriu (conflito),
    //    recupera o registro existente para retornar o id ao frontend.
    //    Frontend precisa do id para chamar o DELETE (undo).
    // --------------------------------------------------
    if (!inserted) {
      const whereClause =
        alertKind === 'sla_unanswered'
          ? {
              company_id:              companyId,
              dismissed_by:            user.id,
              last_inbound_message_id: lastInboundId,
            }
          : {
              company_id:   companyId,
              dismissed_by: user.id,
              entity_id:    entityId,
            }

      const { data: existing } = await svc
        .from('dashboard_alert_dismissals')
        .select('id, dismissed_at')
        .match(whereClause)
        .maybeSingle()

      return res.status(200).json({
        ok:       true,
        data:     existing ?? null,
        idempotent: true,
      })
    }

    return res.status(201).json({ ok: true, data: inserted })

  } catch (err: unknown) {
    logDashboardError('dashboard.alert-dismissals.post', err, {
      endpoint:  '/api/dashboard/alert-dismissals',
      companyId: typeof req.body?.company_id === 'string' ? req.body.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
