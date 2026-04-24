// =====================================================
// API: POST /api/funnel/bulk-move-opportunities/count
//
// Retorna a contagem real de oportunidades válidas para
// o bulk move ANTES de executar a operação.
//
// Usado pelo modal de confirmação para exibir ao usuário
// quantas oportunidades serão efetivamente movidas.
//
// POST (body JSON) para suportar arrays grandes de IDs
// sem limitações de query string.
//
// Retorna:
//   valid_count     — oportunidades que serão movidas
//   requested_count — total de IDs enviados pelo frontend
//   invalid_count   — IDs que não pertencem à etapa/funil
// =====================================================

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL         = process.env.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://etzdsywunlpbgxkphuil.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MAX_OPPORTUNITIES    = 200

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Autenticação ─────────────────────────────────────────────────────
  const authHeader = req.headers.authorization ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' })
  }
  const token = authHeader.slice(7)

  const svc = getServiceClient()
  if (!svc) {
    return res.status(500).json({ error: 'Configuração de servidor incompleta' })
  }

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }

  // ── 2. Extrair campos ───────────────────────────────────────────────────
  const { company_id, from_funnel_id, from_stage_id, opportunity_ids } = req.body ?? {}

  if (!company_id)     return res.status(400).json({ error: 'company_id é obrigatório' })
  if (!from_funnel_id) return res.status(400).json({ error: 'from_funnel_id é obrigatório' })
  if (!from_stage_id)  return res.status(400).json({ error: 'from_stage_id é obrigatório' })

  if (!Array.isArray(opportunity_ids) || opportunity_ids.length === 0) {
    return res.status(400).json({ error: 'opportunity_ids deve ser um array não vazio' })
  }

  // ── 3. Validar membership no banco ──────────────────────────────────────
  // Mesma matriz de RBAC do endpoint principal:
  //   admin, manager         → membership ativa direta
  //   super_admin, system_admin → membership direta OU Trilha 2 (parent-admin)
  //   partner                → membership ativa + assignment em partner_company_assignments
  //   seller                 → bloqueado
  const ALLOWED_ROLES = ['super_admin', 'system_admin', 'partner', 'admin', 'manager']

  const { data: directMembership } = await svc
    .from('company_users')
    .select('role')
    .eq('user_id', user.id)
    .eq('company_id', company_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!directMembership) {
    // Trilha 2: parent-admin acessando empresa filha
    const { data: parentMembership } = await svc
      .from('company_users')
      .select('role, company_id, companies!inner(company_type)')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .in('role', ['super_admin', 'system_admin'])
      .maybeSingle()

    if (!parentMembership || parentMembership.companies?.company_type !== 'parent') {
      return res.status(403).json({ error: 'Sem acesso a esta empresa' })
    }

    const { data: childCheck } = await svc
      .from('companies')
      .select('id')
      .eq('id', company_id)
      .eq('parent_company_id', parentMembership.company_id)
      .maybeSingle()

    if (!childCheck) {
      return res.status(403).json({ error: 'Empresa não encontrada ou sem acesso' })
    }
  } else {
    // Trilha 1: verificar role permitido
    if (!ALLOWED_ROLES.includes(directMembership.role)) {
      return res.status(403).json({
        error:          'Permissão insuficiente',
        required_roles: ALLOWED_ROLES,
        your_role:      directMembership.role,
      })
    }

    // Partner exige assignment explícito em partner_company_assignments para a empresa alvo.
    if (directMembership.role === 'partner') {
      const { data: assignment } = await svc
        .from('partner_company_assignments')
        .select('id')
        .eq('partner_user_id', user.id)
        .eq('company_id', company_id)
        .eq('is_active', true)
        .maybeSingle()

      if (!assignment) {
        return res.status(403).json({ error: 'Partner sem assignment ativo para esta empresa' })
      }
    }
  }

  // ── 4. Contar IDs válidos no banco ──────────────────────────────────────
  const requestedCount = opportunity_ids.length
  const idsToCheck     = opportunity_ids.slice(0, MAX_OPPORTUNITIES)

  const { data: validRows, error: countErr } = await svc
    .from('opportunity_funnel_positions')
    .select('opportunity_id')
    .eq('funnel_id', from_funnel_id)
    .eq('stage_id', from_stage_id)
    .in('opportunity_id', idsToCheck)

  if (countErr) {
    return res.status(500).json({ error: 'Erro ao contar oportunidades', detail: countErr.message })
  }

  const validCount   = validRows?.length ?? 0
  const invalidCount = requestedCount - validCount

  return res.status(200).json({
    valid_count:     validCount,
    requested_count: requestedCount,
    invalid_count:   invalidCount,
  })
}
