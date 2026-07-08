// =====================================================
// GET  /api/contact-cycles/reasons
// POST /api/contact-cycles/reasons
//
// GET  — lista motivos de tentativa da empresa
//   seller+: somente ativos
//   admin+:  pode incluir inativos via include_inactive=true
//
// POST — cria novo motivo (admin+)
//   Campos aceitos: company_id, label
//   Respeita UNIQUE (company_id, label)
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method !== 'GET' && req.method !== 'POST') {
    jsonError(res, 405, 'Método não permitido')
    return
  }

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
    // 2. company_id + membership
    // ------------------------------------------------------------------
    const companyId =
      req.method === 'GET'
        ? (typeof req.query.company_id === 'string' ? req.query.company_id.trim() : '')
        : (typeof req.body?.company_id === 'string' ? req.body.company_id.trim() : '')

    if (!companyId) { jsonError(res, 400, 'company_id é obrigatório'); return }

    const membership = await assertMembership(svc, user.id, companyId)
    if (!membership) { jsonError(res, 403, 'Acesso negado'); return }

    const callerRole = membership.role as string

    // ------------------------------------------------------------------
    // 3. Roteamento
    // ------------------------------------------------------------------
    if (req.method === 'GET') {
      return handleGet(req, res, svc, companyId, callerRole)
    }

    // POST — requer admin+
    if (!ADMIN_ROLES.has(callerRole)) {
      jsonError(res, 403, 'Permissão insuficiente — requer admin, system_admin ou super_admin')
      return
    }

    return handlePost(req, res, svc, companyId)

  } catch (err) {
    console.error('[contact-cycles/reasons] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// GET — lista motivos da empresa
// ──────────────────────────────────────────────────────────────────────────────
async function handleGet(
  req: any,
  res: any,
  svc: any,
  companyId: string,
  callerRole: string,
): Promise<void> {
  const includeInactive =
    ADMIN_ROLES.has(callerRole) && req.query.include_inactive === 'true'

  let query = svc
    .from('contact_attempt_reasons')
    .select('id, label, active, created_at, updated_at')
    .eq('company_id', companyId)
    .order('label', { ascending: true })

  if (!includeInactive) {
    query = query.eq('active', true)
  }

  const { data: reasons, error } = await query

  if (error) {
    console.error('[contact-cycles/reasons] GET error:', error)
    jsonError(res, 500, 'Erro ao buscar motivos')
    return
  }

  res.status(200).json({ ok: true, data: { reasons: reasons ?? [] } })
}

// ──────────────────────────────────────────────────────────────────────────────
// POST — cria novo motivo
// ──────────────────────────────────────────────────────────────────────────────
async function handlePost(req: any, res: any, svc: any, companyId: string): Promise<void> {
  const body = req.body ?? {}

  // Validar label
  const label = typeof body.label === 'string' ? body.label.trim() : null
  if (!label) {
    jsonError(res, 400, 'label é obrigatório e não pode ser vazio')
    return
  }

  const { data: reason, error } = await svc
    .from('contact_attempt_reasons')
    .insert({ company_id: companyId, label, active: true })
    .select('id, label, active, created_at')
    .single()

  if (error) {
    // Tratar violação de unicidade (company_id, label)
    if (error.code === '23505') {
      jsonError(res, 409, `Já existe um motivo com o label "${label}" para esta empresa`)
      return
    }
    console.error('[contact-cycles/reasons] POST error:', error)
    jsonError(res, 500, 'Erro ao criar motivo')
    return
  }

  res.status(201).json({ ok: true, data: { reason } })
}
