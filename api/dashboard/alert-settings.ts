// =====================================================
// GET  /api/dashboard/alert-settings?company_id=UUID
// POST /api/dashboard/alert-settings
//
// Gerencia configurações personalizadas de alertas do dashboard por empresa.
//
// GET — qualquer membro ativo da empresa pode ler:
//   Query params: company_id (UUID, obrigatório)
//   Response: { ok, data: { sla_settings, stalled_settings, seller_risk_settings }, meta }
//   Se não houver registro salvo: retorna GLOBAL_DEFAULTS com meta.is_default = true
//   Se houver registro salvo:     retorna os valores do banco com meta.updated_at
//
// POST — restrito a admin / system_admin / super_admin:
//   Body: { company_id, sla_settings?, stalled_settings?, seller_risk_settings?, funnel_scope_settings? }
//   Merge seguro: seção ausente mantém valor atual/default; seção presente deve estar completa
//   Campos extras dentro de cada seção são REJEITADOS (evita persistência silenciosa)
//   updated_by é SEMPRE user.id do JWT — nunca aceito do payload
//   Upsert ON CONFLICT (company_id): cria ou atualiza sem race condition
//
// Segurança:
//   • Membership validado via assertMembership (company_users is_active=true)
//   • RBAC para escrita: ADMIN_ROLES = {admin, system_admin, super_admin}
//   • partner / manager / seller → 403 no POST
//   • service_role em todas as queries após validação de auth
//   • updated_by nunca vem do payload
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'
import { logDashboardError } from '../lib/dashboard/observability.js'
import {
  GLOBAL_DEFAULTS,
  ADMIN_ROLES,
  validateSlaSettings,
  validateStalledSettings,
  validateSellerRiskSettings,
  validateFunnelScopeSettings,
  type AlertSettings,
  type SlaSettings,
  type StalledSettings,
  type SellerRiskSettings,
  type FunnelScopeSettings,
} from '../lib/dashboard/alertSettingsDefaults.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method === 'GET')  { await handleGet(req, res); return }
  if (req.method === 'POST') { await handlePost(req, res); return }

  jsonError(res, 405, 'Método não permitido')
}

// =====================================================
// GET
// =====================================================
async function handleGet(req: any, res: any): Promise<void> {
  try {
    // 1. Autenticação
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // 2. Validação do company_id
    const companyId = typeof req.query.company_id === 'string' ? req.query.company_id.trim() : ''
    if (!isUUID(companyId)) { jsonError(res, 400, 'company_id inválido ou ausente'); return }

    // 3. Membership — qualquer role ativo pode ler
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    // 4. Leitura das configurações
    const { data, error: dbError } = await svc
      .from('dashboard_alert_settings')
      .select('sla_settings, stalled_settings, seller_risk_settings, funnel_scope_settings, updated_at')
      .eq('company_id', companyId)
      .maybeSingle()

    if (dbError) {
      logDashboardError('dashboard.alert-settings.get', dbError, { companyId })
      jsonError(res, 500, 'Erro ao buscar configurações'); return
    }

    // 5. Sem linha: retorna defaults globais
    if (!data) {
      return res.status(200).json({
        ok:   true,
        data: GLOBAL_DEFAULTS,
        meta: { is_default: true },
      })
    }

    // 6. Com linha: retorna valores do banco + updated_at no meta
    return res.status(200).json({
      ok:   true,
      data: {
        sla_settings:          data.sla_settings          as SlaSettings,
        stalled_settings:      data.stalled_settings      as StalledSettings,
        seller_risk_settings:  data.seller_risk_settings  as SellerRiskSettings,
        funnel_scope_settings: (data.funnel_scope_settings as FunnelScopeSettings) ?? GLOBAL_DEFAULTS.funnel_scope_settings,
      } satisfies AlertSettings,
      meta: {
        is_default: false,
        updated_at: data.updated_at as string,
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.alert-settings.get', err, {
      endpoint:  '/api/dashboard/alert-settings',
      companyId: typeof req.query.company_id === 'string' ? req.query.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

// =====================================================
// POST
// =====================================================
async function handlePost(req: any, res: any): Promise<void> {
  try {
    // 1. Autenticação
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // 2. Validação do body básico
    const body = req.body ?? {}

    const companyId = typeof body.company_id === 'string' ? body.company_id.trim() : ''
    if (!isUUID(companyId)) { jsonError(res, 400, 'company_id inválido ou ausente'); return }

    // 3. Membership + RBAC — apenas admin/system_admin/super_admin podem gravar
    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    if (!ADMIN_ROLES.has(membership.role)) {
      jsonError(res, 403, 'Permissão insuficiente — necessário admin ou superior'); return
    }

    // 4. Verificar se ao menos uma seção foi enviada
    const hasSla         = 'sla_settings' in body
    const hasStalled     = 'stalled_settings' in body
    const hasSellerRisk  = 'seller_risk_settings' in body
    const hasFunnelScope = 'funnel_scope_settings' in body

    if (!hasSla && !hasStalled && !hasSellerRisk && !hasFunnelScope) {
      jsonError(res, 400, 'Informe ao menos uma seção: sla_settings, stalled_settings, seller_risk_settings ou funnel_scope_settings'); return
    }

    // 5. Validar cada seção presente (completa e sem campos extras)
    if (hasSla) {
      const err = validateSlaSettings(body.sla_settings)
      if (err) { jsonError(res, 400, err); return }
    }
    if (hasStalled) {
      const err = validateStalledSettings(body.stalled_settings)
      if (err) { jsonError(res, 400, err); return }
    }
    if (hasSellerRisk) {
      const err = validateSellerRiskSettings(body.seller_risk_settings)
      if (err) { jsonError(res, 400, err); return }
    }
    if (hasFunnelScope) {
      const err = validateFunnelScopeSettings(body.funnel_scope_settings)
      if (err) { jsonError(res, 400, err); return }

      // Validação de ownership: todos os stage_ids devem pertencer à empresa atual
      // Impede referência cruzada entre tenants
      const scope = body.funnel_scope_settings as FunnelScopeSettings
      if (scope.mode === 'custom' && scope.stage_ids && scope.stage_ids.length > 0) {
        const { data: validStages, error: stagesError } = await svc
          .from('funnel_stages')
          .select('id, funnel_id, sales_funnels!inner(company_id)')
          .in('id', scope.stage_ids)
          .eq('sales_funnels.company_id', companyId)

        if (stagesError) {
          logDashboardError('dashboard.alert-settings.post.stages', stagesError, { companyId })
          jsonError(res, 500, 'Erro ao validar etapas'); return
        }

        const validIds = new Set((validStages ?? []).map((s: { id: string }) => s.id))
        const invalid  = scope.stage_ids.filter(id => !validIds.has(id))

        if (invalid.length > 0) {
          jsonError(res, 400, `funnel_scope_settings: stage_ids contém etapas inválidas ou de outra empresa`); return
        }
      }
    }

    // 6. Merge seguro:
    //    - Seção presente: usa o valor validado do body (completo)
    //    - Seção ausente:  usa o valor atual do banco ou o default global
    let currentSla         = GLOBAL_DEFAULTS.sla_settings
    let currentStalled     = GLOBAL_DEFAULTS.stalled_settings
    let currentSellerRisk  = GLOBAL_DEFAULTS.seller_risk_settings
    let currentFunnelScope = GLOBAL_DEFAULTS.funnel_scope_settings

    if (!hasSla || !hasStalled || !hasSellerRisk || !hasFunnelScope) {
      // Só busca o estado atual quando há seções ausentes (evita query desnecessária)
      const { data: existing } = await svc
        .from('dashboard_alert_settings')
        .select('sla_settings, stalled_settings, seller_risk_settings, funnel_scope_settings')
        .eq('company_id', companyId)
        .maybeSingle()

      if (existing) {
        currentSla         = (existing.sla_settings          as SlaSettings)        ?? GLOBAL_DEFAULTS.sla_settings
        currentStalled     = (existing.stalled_settings      as StalledSettings)    ?? GLOBAL_DEFAULTS.stalled_settings
        currentSellerRisk  = (existing.seller_risk_settings  as SellerRiskSettings) ?? GLOBAL_DEFAULTS.seller_risk_settings
        currentFunnelScope = (existing.funnel_scope_settings as FunnelScopeSettings) ?? GLOBAL_DEFAULTS.funnel_scope_settings
      }
    }

    const mergedSla         = hasSla         ? (body.sla_settings          as SlaSettings)        : currentSla
    const mergedStalled     = hasStalled     ? (body.stalled_settings      as StalledSettings)    : currentStalled
    const mergedSellerRisk  = hasSellerRisk  ? (body.seller_risk_settings  as SellerRiskSettings) : currentSellerRisk
    const mergedFunnelScope = hasFunnelScope ? (body.funnel_scope_settings as FunnelScopeSettings) : currentFunnelScope

    // 7. Upsert — service_role (autorização já validada acima)
    //    updated_by é SEMPRE user.id do JWT, nunca aceito do payload
    //    ON CONFLICT (company_id) funciona corretamente aqui:
    //    o índice UNIQUE simples em company_id não tem WHERE predicate
    //    → sem limitação do Supabase JS v2 com partial indexes
    const { data: saved, error: upsertError } = await svc
      .from('dashboard_alert_settings')
      .upsert(
        {
          company_id:            companyId,
          sla_settings:          mergedSla,
          stalled_settings:      mergedStalled,
          seller_risk_settings:  mergedSellerRisk,
          funnel_scope_settings: mergedFunnelScope,
          updated_by:            user.id,
        },
        { onConflict: 'company_id' },
      )
      .select('sla_settings, stalled_settings, seller_risk_settings, funnel_scope_settings, updated_at')
      .single()

    if (upsertError) {
      logDashboardError('dashboard.alert-settings.post', upsertError, { companyId })
      jsonError(res, 500, 'Erro ao salvar configurações'); return
    }

    return res.status(200).json({
      ok:   true,
      data: {
        sla_settings:          saved.sla_settings          as SlaSettings,
        stalled_settings:      saved.stalled_settings      as StalledSettings,
        seller_risk_settings:  saved.seller_risk_settings  as SellerRiskSettings,
        funnel_scope_settings: (saved.funnel_scope_settings as FunnelScopeSettings) ?? GLOBAL_DEFAULTS.funnel_scope_settings,
      } satisfies AlertSettings,
      meta: {
        updated_at: saved.updated_at as string,
      },
    })

  } catch (err: unknown) {
    logDashboardError('dashboard.alert-settings.post', err, {
      endpoint:  '/api/dashboard/alert-settings',
      companyId: typeof req.body?.company_id === 'string' ? req.body.company_id : undefined,
    })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}
