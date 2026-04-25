// =============================================================================
// GET /api/public/plans
//
// Catálogo público de planos do Lovoo CRM para exibição na landing page.
// Endpoint sem autenticação — retorna apenas dados seguros de vitrine.
//
// MÉTODO:
//   GET  → retorna planos ativos e listados publicamente
//   OPTIONS → preflight CORS
//   Demais → 405
//
// FILTROS:
//   is_active = true AND is_publicly_listed = true
//   Ordenação: sort_order ASC
//
// RESPOSTA 200:
//   {
//     ok: true,
//     plans: [{
//       id, name, slug, description, price, currency,
//       interval, display_order, highlighted, badge, cta,
//       features, limits
//     }]
//   }
//
// SEGURANÇA:
//   - Nenhuma autenticação necessária (endpoint público de vitrine)
//   - service_role usado SOMENTE no backend; nunca exposto ao client
//   - select() com whitelist explícita — nunca select('*')
//   - Não retorna: stripe_price_id_monthly, ai_plan_id, custos internos,
//     dados de assinatura, company_id ou qualquer campo de governança
//
// CACHE:
//   Cache-Control: public, s-maxage=300, stale-while-revalidate=600
//
// CORS:
//   Allowlist: https://lovoocrm.com, https://www.lovoocrm.com
//   + origens extras via env PUBLIC_PLANS_CORS_ORIGINS (separadas por vírgula)
// =============================================================================

import { getServiceSupabase } from '../lib/credits/authContext.js'

// ── Campos de plano públicos (whitelist — não usar select('*')) ────────────────
const PLAN_SELECT = [
  'id',
  'name',
  'slug',
  'description',
  'price',
  'currency',
  'billing_cycle',
  'sort_order',
  'is_popular',
  'features',
  'max_whatsapp_instances',
  'max_landing_pages',
  'max_leads',
  'max_users',
  'max_funnels',
  'max_funnel_stages',
  'max_automation_flows',
  'max_automation_executions_monthly',
  'max_products',
  'storage_mb',
].join(', ')

// ── Origens CORS permitidas ────────────────────────────────────────────────────
const BASE_CORS_ORIGINS = new Set([
  'https://lovoocrm.com',
  'https://www.lovoocrm.com',
])

function getAllowedOrigins() {
  const extras = process.env.PUBLIC_PLANS_CORS_ORIGINS ?? ''
  const set = new Set(BASE_CORS_ORIGINS)
  extras
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .forEach(o => set.add(o))
  return set
}

function setCorsHeaders(req, res) {
  const origin = req.headers?.origin ?? ''
  const allowed = getAllowedOrigins()

  if (origin && allowed.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
}

// ── Mapeamento de campo do banco → campo público ───────────────────────────────
function mapPlan(raw) {
  return {
    id:            raw.id,
    name:          raw.name,
    slug:          raw.slug,
    description:   raw.description ?? null,
    price:         Number(raw.price ?? 0),
    currency:      raw.currency,
    interval:      raw.billing_cycle,
    display_order: raw.sort_order,
    highlighted:   raw.is_popular === true,
    badge:         raw.is_popular === true ? 'Melhor custo-benefício' : null,
    cta:           raw.slug === 'elite' ? 'Falar com especialista' : 'Começar teste grátis',
    features:      raw.features ?? {},
    limits: {
      max_whatsapp_instances:            raw.max_whatsapp_instances            ?? null,
      max_landing_pages:                 raw.max_landing_pages                 ?? null,
      max_leads:                         raw.max_leads                         ?? null,
      max_users:                         raw.max_users                         ?? null,
      max_funnels:                       raw.max_funnels                       ?? null,
      max_funnel_stages:                 raw.max_funnel_stages                 ?? null,
      max_automation_flows:              raw.max_automation_flows              ?? null,
      max_automation_executions_monthly: raw.max_automation_executions_monthly ?? null,
      max_products:                      raw.max_products                      ?? null,
      storage_mb:                        raw.storage_mb                        ?? null,
    },
  }
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  setCorsHeaders(req, res)
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  // Somente GET
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' })
  }

  // Validar configuração mínima de backend
  const svc = getServiceSupabase()
  if (!svc) {
    console.error('[GET /api/public/plans] Configuração de backend ausente (SUPABASE vars)')
    return res.status(500).json({ ok: false, error: 'internal_error' })
  }

  try {
    const { data, error } = await svc
      .from('plans')
      .select(PLAN_SELECT)
      .eq('is_active', true)
      .eq('is_publicly_listed', true)
      .order('sort_order', { ascending: true })

    if (error) {
      console.error('[GET /api/public/plans] Erro ao buscar planos:', error.message)
      return res.status(500).json({ ok: false, error: 'internal_error' })
    }

    const plans = (data ?? []).map(mapPlan)

    return res.status(200).json({ ok: true, plans })
  } catch (err) {
    console.error('[GET /api/public/plans] Exceção inesperada:', err?.message ?? err)
    return res.status(500).json({ ok: false, error: 'internal_error' })
  }
}
