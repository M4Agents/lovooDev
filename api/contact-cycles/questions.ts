// =====================================================
// GET  /api/contact-cycles/questions
// POST /api/contact-cycles/questions
//
// GET  — lista perguntas dinâmicas da empresa
//   seller+: somente ativas, ordenadas por sort_order ASC, created_at ASC
//   admin+:  pode incluir inativas via include_inactive=true
//
// POST — cria nova pergunta (admin+)
//   Campos aceitos: company_id, label, field_type, options, required, sort_order
//   field_type deve ser um dos valores permitidos
//   Se field_type = 'select', options é obrigatório e deve ser array não vazio
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

// Tipos de campo suportados pelo motor de perguntas dinâmicas
const VALID_FIELD_TYPES = new Set(['text', 'textarea', 'select', 'boolean', 'number'])

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
    console.error('[contact-cycles/questions] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// GET — lista perguntas da empresa
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
    .from('contact_attempt_questions')
    .select('id, label, field_type, options, required, sort_order, active, created_at, updated_at')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (!includeInactive) {
    query = query.eq('active', true)
  }

  const { data: questions, error } = await query

  if (error) {
    console.error('[contact-cycles/questions] GET error:', error)
    jsonError(res, 500, 'Erro ao buscar perguntas')
    return
  }

  res.status(200).json({ ok: true, data: { questions: questions ?? [] } })
}

// ──────────────────────────────────────────────────────────────────────────────
// POST — cria nova pergunta
// ──────────────────────────────────────────────────────────────────────────────
async function handlePost(req: any, res: any, svc: any, companyId: string): Promise<void> {
  const body = req.body ?? {}

  // ── label ─────────────────────────────────────────────────────────────────
  const label = typeof body.label === 'string' ? body.label.trim() : null
  if (!label) {
    jsonError(res, 400, 'label é obrigatório e não pode ser vazio')
    return
  }

  // ── field_type ─────────────────────────────────────────────────────────────
  const fieldType = typeof body.field_type === 'string' ? body.field_type.trim() : ''
  if (!fieldType || !VALID_FIELD_TYPES.has(fieldType)) {
    jsonError(
      res,
      400,
      `field_type inválido — valores aceitos: ${[...VALID_FIELD_TYPES].join(', ')}`,
    )
    return
  }

  // ── options (obrigatório para select) ──────────────────────────────────────
  let options: unknown = body.options ?? null

  if (fieldType === 'select') {
    if (!Array.isArray(options) || options.length === 0) {
      jsonError(res, 400, 'options é obrigatório para field_type "select" e deve ser um array não vazio')
      return
    }
    // Cada opção deve ser uma string não vazia
    const allStrings = options.every((o: unknown) => typeof o === 'string' && o.trim().length > 0)
    if (!allStrings) {
      jsonError(res, 400, 'Cada item de options deve ser uma string não vazia')
      return
    }
    options = (options as string[]).map((o: string) => o.trim())
  } else {
    // options ignorado para outros tipos
    options = null
  }

  // ── required ──────────────────────────────────────────────────────────────
  let required = false
  if ('required' in body) {
    if (typeof body.required !== 'boolean') {
      jsonError(res, 400, 'required deve ser boolean')
      return
    }
    required = body.required
  }

  // ── sort_order ────────────────────────────────────────────────────────────
  let sortOrder = 0
  if ('sort_order' in body) {
    const parsed = Number(body.sort_order)
    if (!Number.isInteger(parsed) || parsed < 0) {
      jsonError(res, 400, 'sort_order deve ser um inteiro não-negativo')
      return
    }
    sortOrder = parsed
  }

  // ── Insert ────────────────────────────────────────────────────────────────
  const { data: question, error } = await svc
    .from('contact_attempt_questions')
    .insert({
      company_id:  companyId,
      label,
      field_type:  fieldType,
      options,
      required,
      sort_order:  sortOrder,
      active:      true,
    })
    .select('id, label, field_type, options, required, sort_order, active, created_at')
    .single()

  if (error) {
    console.error('[contact-cycles/questions] POST error:', error)
    jsonError(res, 500, 'Erro ao criar pergunta')
    return
  }

  res.status(201).json({ ok: true, data: { question } })
}
