// =====================================================
// DELETE /api/dashboard/alert-dismissals/[id]
//
// Desfaz (undo) uma dispensa de alerta do dashboard.
// O alerta volta a aparecer nas próximas chamadas às RPCs.
//
// Path param:
//   id          UUID da dispensa (dashboard_alert_dismissals.id)
//
// Query param:
//   company_id  UUID da empresa (para validação de membership)
//
// Autorização:
//   • O próprio usuário que dispensou pode desfazer (dismissed_by = user.id)
//   • admin, system_admin, super_admin podem desfazer qualquer dispensa da empresa
//   • manager e seller não podem desfazer dispensas de outros usuários
//
// Segurança:
//   • dismissal.company_id comparado com company_id do query param
//     → impede deleção cross-tenant mesmo com id correto
//   • DELETE com dupla condição (id AND company_id) como camada extra
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { logDashboardError } from '../lib/dashboard/observability.js'

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method !== 'DELETE')  { jsonError(res, 405, 'Método não permitido'); return }

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
    // 2. Parâmetros
    // --------------------------------------------------
    const dismissalId = typeof req.query.id === 'string' ? req.query.id.trim() : ''
    const companyId   = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''

    if (!isUUID(dismissalId)) { jsonError(res, 400, 'id inválido'); return }
    if (!isUUID(companyId))   { jsonError(res, 400, 'company_id é obrigatório'); return }

    // --------------------------------------------------
    // 3. Membership — usuário ativo na empresa
    // --------------------------------------------------
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    const callerRole = membership.role

    // --------------------------------------------------
    // 4. Buscar a dispensa pelo id
    //    service_role garante acesso ao registro independente de RLS.
    //    A verificação de autorização é feita na camada de aplicação.
    // --------------------------------------------------
    const { data: dismissal, error: fetchError } = await svc
      .from('dashboard_alert_dismissals')
      .select('id, company_id, dismissed_by, alert_kind, entity_type')
      .eq('id', dismissalId)
      .maybeSingle()

    if (fetchError) {
      logDashboardError('dashboard.alert-dismissals.delete', fetchError, { companyId })
      jsonError(res, 500, 'Erro ao buscar dispensa'); return
    }

    if (!dismissal) { jsonError(res, 404, 'Dispensa não encontrada'); return }

    // --------------------------------------------------
    // 5. Verificação cross-tenant
    //    Garante que o registro pertence à empresa declarada no request.
    //    Sem isso, um usuário com o id correto poderia deletar
    //    dispensas de outras empresas.
    // --------------------------------------------------
    if (dismissal.company_id !== companyId) {
      jsonError(res, 403, 'Acesso negado'); return
    }

    // --------------------------------------------------
    // 6. Autorização:
    //    • Dono da dispensa sempre pode desfazer
    //    • Admin+ pode desfazer qualquer dispensa da empresa
    //    • manager/seller não podem desfazer dispensas de outros
    // --------------------------------------------------
    const isOwner      = dismissal.dismissed_by === user.id
    const isAdminPlus  = ADMIN_ROLES.has(callerRole)

    if (!isOwner && !isAdminPlus) {
      jsonError(res, 403, 'Sem permissão para desfazer a dispensa de outro usuário'); return
    }

    // --------------------------------------------------
    // 7. DELETE com dupla condição (id + company_id)
    //    Camada extra de proteção além da verificação de aplicação.
    // --------------------------------------------------
    const { error: deleteError } = await svc
      .from('dashboard_alert_dismissals')
      .delete()
      .eq('id', dismissalId)
      .eq('company_id', companyId)

    if (deleteError) {
      logDashboardError('dashboard.alert-dismissals.delete', deleteError, { companyId })
      jsonError(res, 500, 'Erro ao desfazer dispensa'); return
    }

    return res.status(200).json({ ok: true })

  } catch (err: unknown) {
    logDashboardError('dashboard.alert-dismissals.delete', err, {
      endpoint:  '/api/dashboard/alert-dismissals/[id]',
      companyId: typeof req.query?.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
