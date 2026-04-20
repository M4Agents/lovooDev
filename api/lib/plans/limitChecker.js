// =============================================================================
// api/lib/plans/limitChecker.js
//
// Helper backend de leitura e enforcement dos limites de plano.
//
// RESPONSABILIDADE:
//   - Buscar limits do plano via companies.plan_id → plans → ai_plans
//   - Retornar estrutura padronizada de limites CRM e IA
//   - Tratamento de NULL = ilimitado
//   - Enforcement via assertPlanLimit / assertPlanFeature
//
// PADRÃO DE ERRO:
//   Limite numérico excedido:
//     { error: 'plan_limit_exceeded', limit_key, max_allowed, current }
//   Feature desabilitada:
//     { error: 'plan_feature_disabled', feature_key }
//
// USO BÁSICO (uma só leitura de plano):
//   const limits = await getPlanLimits(svc, companyId)
//   assertLimitFromLoaded(limits, 'max_users', currentCount)
//   assertFeatureFromLoaded(limits, 'multiple_agents_enabled')
//
// USO CONVENIENCE (lê plano internamente):
//   await assertPlanLimit(svc, companyId, 'max_leads', async () => countFn())
//   await assertPlanFeature(svc, companyId, 'follow_up_agent_enabled')
//
// HANDLERS HTTP — capturar PlanEnforcementError:
//   try { assertLimitFromLoaded(...) }
//   catch (err) {
//     if (err.isPlanError) return res.status(err.httpStatus).json(err.data)
//     throw err
//   }
//
// NULL em qualquer max_* = ilimitado (não bloqueia)
// companies.plan_id → plans sempre (NÃO usa companies.plan slug legado)
// =============================================================================

/**
 * @typedef {Object} PlanLimits
 * @property {string|null}  plan_id
 * @property {string|null}  plan_name
 * @property {string|null}  plan_slug
 * @property {string|null}  ai_plan_id
 * @property {string|null}  ai_plan_name
 * @property {number|null}  ai_plan_monthly_credits   — null = ilimitado
 * @property {number|null}  max_whatsapp_instances    — null = ilimitado
 * @property {number|null}  max_leads                 — null = ilimitado
 * @property {number|null}  max_users                 — null = ilimitado
 * @property {number|null}  max_funnels               — null = ilimitado
 * @property {number|null}  max_funnel_stages         — null = ilimitado
 * @property {number|null}  max_automation_flows      — null = ilimitado
 * @property {number|null}  max_automation_executions_monthly — null = ilimitado
 * @property {number|null}  max_products              — null = ilimitado
 * @property {number|null}  storage_mb                — null = ilimitado
 * @property {Record<string,boolean>} features        — JSONB features do plano
 * @property {boolean}      has_plan                  — se a empresa tem plano configurado
 */

/**
 * Busca os limites do plano de uma empresa via plan_id FK.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc - client com service_role
 * @param {string} companyId - UUID da empresa
 * @returns {Promise<PlanLimits>}
 */
export async function getPlanLimits(svc, companyId) {
  const { data, error } = await svc
    .from('companies')
    .select(`
      plan_id,
      plans!plan_id (
        id,
        name,
        slug,
        max_whatsapp_instances,
        max_leads,
        max_users,
        max_landing_pages,
        max_funnels,
        max_funnel_stages,
        max_automation_flows,
        max_automation_executions_monthly,
        max_products,
        storage_mb,
        features,
        ai_plan_id,
        ai_plans!ai_plan_id (
          id,
          name,
          monthly_credits
        )
      )
    `)
    .eq('id', companyId)
    .maybeSingle()

  if (error || !data) {
    return buildEmptyLimits()
  }

  const plan   = data.plans
  const aiPlan = plan?.ai_plans

  if (!plan) {
    // Empresa sem plan_id configurado ainda (transição)
    return buildEmptyLimits()
  }

  return {
    plan_id:    plan.id ?? null,
    plan_name:  plan.name ?? null,
    plan_slug:  plan.slug ?? null,
    ai_plan_id: aiPlan?.id ?? null,
    ai_plan_name: aiPlan?.name ?? null,
    ai_plan_monthly_credits: aiPlan?.monthly_credits ?? null,
    max_whatsapp_instances:           plan.max_whatsapp_instances           ?? null,
    max_leads:                        plan.max_leads                        ?? null,
    max_users:                        plan.max_users                        ?? null,
    max_funnels:                      plan.max_funnels                      ?? null,
    max_funnel_stages:                plan.max_funnel_stages                ?? null,
    max_automation_flows:             plan.max_automation_flows             ?? null,
    max_automation_executions_monthly:plan.max_automation_executions_monthly ?? null,
    max_products:                     plan.max_products                     ?? null,
    storage_mb:                       plan.storage_mb                       ?? null,
    features: (typeof plan.features === 'object' && plan.features !== null && !Array.isArray(plan.features))
      ? plan.features
      : {},
    has_plan: true,
  }
}

/**
 * Verifica se uma empresa ultrapassou um limite específico.
 *
 * @param {number|null} limit  - valor do limite (null = ilimitado)
 * @param {number} current     - contagem atual
 * @returns {{ allowed: boolean; limit: number|null; current: number; remaining: number|null }}
 */
export function checkLimit(limit, current) {
  // NULL = ilimitado — sempre permitido
  if (limit === null || limit === undefined) {
    return { allowed: true, limit: null, current, remaining: null }
  }
  const remaining = Math.max(0, limit - current)
  return {
    allowed:   current < limit,
    limit,
    current,
    remaining,
  }
}

/**
 * Verifica se uma feature está habilitada no plano.
 *
 * @param {Record<string,boolean>} features - features JSONB do plano
 * @param {string} featureKey               - chave com sufixo _enabled
 * @returns {boolean}
 */
export function checkFeature(features, featureKey) {
  if (!features || typeof features !== 'object') return false
  return features[featureKey] === true
}

// =============================================================================
// ENFORCEMENT — PlanEnforcementError + assert helpers
// =============================================================================

/**
 * Erro estruturado de enforcement de plano.
 *
 * isPlanError = true permite que handlers HTTP o identifiquem e retornem 403
 * sem capturar outros erros acidentalmente.
 *
 * Para limites:  { error: 'plan_limit_exceeded',  limit_key, max_allowed, current }
 * Para features: { error: 'plan_feature_disabled', feature_key }
 */
export class PlanEnforcementError extends Error {
  constructor(data) {
    super(data.error)
    this.isPlanError = true
    this.httpStatus  = 403
    this.data        = data
  }
}

/**
 * Verifica um limite numérico usando limites já carregados e lança
 * PlanEnforcementError se excedido.
 *
 * Usar quando os limites já foram lidos (evita segunda chamada ao banco).
 *
 * @param {PlanLimits} limits      - resultado de getPlanLimits()
 * @param {string}     limitKey    - ex: 'max_users', 'max_leads'
 * @param {number}     currentCount - contagem atual do recurso
 * @throws {PlanEnforcementError}
 */
export function assertLimitFromLoaded(limits, limitKey, currentCount) {
  const max = limits[limitKey] ?? null
  // NULL = ilimitado — não bloqueia
  if (max === null) return

  if (currentCount >= max) {
    throw new PlanEnforcementError({
      error:       'plan_limit_exceeded',
      limit_key:   limitKey,
      max_allowed: max,
      current:     currentCount,
    })
  }
}

/**
 * Verifica se uma feature está habilitada usando limites já carregados e lança
 * PlanEnforcementError se desabilitada.
 *
 * Usar quando os limites já foram lidos (evita segunda chamada ao banco).
 *
 * @param {PlanLimits} limits     - resultado de getPlanLimits()
 * @param {string}     featureKey - ex: 'multiple_agents_enabled'
 * @throws {PlanEnforcementError}
 */
export function assertFeatureFromLoaded(limits, featureKey) {
  if (!checkFeature(limits.features, featureKey)) {
    throw new PlanEnforcementError({
      error:       'plan_feature_disabled',
      feature_key: featureKey,
    })
  }
}

/**
 * Convenience: lê o plano e verifica um limite numérico em uma só chamada.
 *
 * Para verificar múltiplos limites no mesmo request, prefira getPlanLimits() +
 * assertLimitFromLoaded() para evitar leituras duplicadas do banco.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string}             companyId
 * @param {string}             limitKey      - ex: 'max_users'
 * @param {() => Promise<number>} getCurrentCount - async callback que retorna o total atual
 * @throws {PlanEnforcementError}
 */
export async function assertPlanLimit(svc, companyId, limitKey, getCurrentCount) {
  const limits = await getPlanLimits(svc, companyId)
  const max    = limits[limitKey] ?? null
  // NULL = ilimitado — não consulta banco desnecessariamente
  if (max === null) return

  const current = await getCurrentCount()
  assertLimitFromLoaded(limits, limitKey, current)
}

/**
 * Convenience: lê o plano e verifica se uma feature está habilitada em uma só chamada.
 *
 * Para verificar múltiplas features no mesmo request, prefira getPlanLimits() +
 * assertFeatureFromLoaded() para evitar leituras duplicadas do banco.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc
 * @param {string} companyId
 * @param {string} featureKey - ex: 'follow_up_agent_enabled'
 * @throws {PlanEnforcementError}
 */
export async function assertPlanFeature(svc, companyId, featureKey) {
  const limits = await getPlanLimits(svc, companyId)
  assertFeatureFromLoaded(limits, featureKey)
}

// =============================================================================
// STORAGE — assertStorageLimit
// =============================================================================

/**
 * Verifica se um novo upload vai ultrapassar o limite de storage do plano.
 * Hard block para uploads deliberados (biblioteca, presigned URL, etc.).
 *
 * Comportamento:
 *   - plans.storage_mb = NULL → ilimitado, sem verificação
 *   - Erro na query de storage → fail-CLOSED: lança PlanEnforcementError('plan_validation_failed')
 *   - total_after > storage_mb → lança PlanEnforcementError('plan_storage_limit_exceeded')
 *
 * Cálculo de storage via RPC get_company_storage_used_mb:
 *   lead_media_unified + company_media_library + chat_messages.media_file_size
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} svc - client com service_role
 * @param {string} companyId    - UUID da empresa
 * @param {number} fileSizeBytes - tamanho do arquivo em BYTES
 * @throws {PlanEnforcementError} se o upload ultrapassar o limite
 */
export async function assertStorageLimit(svc, companyId, fileSizeBytes) {
  const limits = await getPlanLimits(svc, companyId)
  const maxMb  = limits.storage_mb ?? null

  // NULL = ilimitado — sai imediatamente sem consultar banco
  if (maxMb === null) return

  const { data, error } = await svc.rpc('get_company_storage_used_mb', {
    p_company_id: companyId,
  })

  if (error) {
    // Fail-closed: falha na validação de storage BLOQUEIA o upload deliberado.
    // Permitir um upload sem confirmar o limite viola a garantia do plano.
    // O usuário pode tentar novamente; instabilidade pontual não abre bypass.
    console.error('[assertStorageLimit] Erro ao calcular storage usado — bloqueando upload:', error.message)
    throw new PlanEnforcementError({
      error:   'plan_validation_failed',
      message: 'Não foi possível validar o armazenamento do seu plano. Tente novamente em instantes.',
    })
  }

  const usedMb     = parseFloat(data) || 0
  const incomingMb = fileSizeBytes / 1048576

  if (usedMb + incomingMb > maxMb) {
    throw new PlanEnforcementError({
      error:           'plan_storage_limit_exceeded',
      max_allowed_mb:  maxMb,
      current_used_mb: Math.round(usedMb * 100) / 100,
      incoming_mb:     Math.round(incomingMb * 100) / 100,
    })
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────────

function buildEmptyLimits() {
  return {
    plan_id:                           null,
    plan_name:                         null,
    plan_slug:                         null,
    ai_plan_id:                        null,
    ai_plan_name:                      null,
    ai_plan_monthly_credits:           null,
    max_whatsapp_instances:            null,
    max_leads:                         null,
    max_users:                         null,
    max_funnels:                       null,
    max_funnel_stages:                 null,
    max_automation_flows:              null,
    max_automation_executions_monthly: null,
    max_products:                      null,
    storage_mb:                        null,
    features:                          {},
    has_plan:                          false,
  }
}
