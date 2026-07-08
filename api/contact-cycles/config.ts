// =====================================================
// GET  /api/contact-cycles/config
// PUT  /api/contact-cycles/config
//
// Gerencia a configuração de ciclos de contato da empresa.
//
// GET — leitura da configuração atual (seller+)
// PUT — criação/atualização da configuração (admin+)
//       Se `enabled` transitar de false/null → true, chama
//       seed_default_contact_attempt_reasons (idempotente).
//
// Query/body params:
//   company_id             (obrigatório)
//   enabled                (boolean)
//   eligibility_rule       (text: 'hours' | ...)
//   eligibility_hours      (integer)
//   show_extra_questions   (boolean)
// =====================================================

import { getSupabaseAdmin } from '../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  getUserFromToken,
  assertMembership,
  jsonError,
} from '../lib/dashboard/auth.js'

// Roles com permissão de escrita na configuração
const ADMIN_ROLES = new Set(['admin', 'system_admin', 'super_admin'])

// Valores válidos para eligibility_rule
const VALID_ELIGIBILITY_RULES = new Set(['hours'])

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') { res.status(204).end(); return }

  if (req.method !== 'GET' && req.method !== 'PUT') {
    jsonError(res, 405, 'Método não permitido')
    return
  }

  try {
    // ------------------------------------------------------------------
    // 1. Auth — JWT via anon key (nunca service_role para validar JWT)
    // ------------------------------------------------------------------
    const token = extractToken(req.headers.authorization)
    if (!token) { jsonError(res, 401, 'Não autenticado'); return }

    const { user, error: authError } = await getUserFromToken(token)
    if (authError || !user) { jsonError(res, 401, 'Token inválido ou expirado'); return }

    const svc = getSupabaseAdmin()

    // ------------------------------------------------------------------
    // 2. company_id + membership (Trilha 1 e 2, is_active = true)
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
    // 3. Roteamento por método
    // ------------------------------------------------------------------
    if (req.method === 'GET') {
      return handleGet(res, svc, companyId)
    }

    // PUT — requer admin+
    if (!ADMIN_ROLES.has(callerRole)) {
      jsonError(res, 403, 'Permissão insuficiente — requer admin, system_admin ou super_admin')
      return
    }

    return handlePut(req, res, svc, companyId)

  } catch (err) {
    console.error('[contact-cycles/config] Erro interno:', err)
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// GET — retorna configuração atual (null se ainda não existe)
// ──────────────────────────────────────────────────────────────────────────────
async function handleGet(res: any, svc: any, companyId: string): Promise<void> {
  const { data: config, error } = await svc
    .from('company_contact_cycle_config')
    .select('enabled, eligibility_rule, eligibility_hours, show_extra_questions, updated_at')
    .eq('company_id', companyId)
    .maybeSingle()

  if (error) {
    console.error('[contact-cycles/config] GET error:', error)
    jsonError(res, 500, 'Erro ao buscar configuração')
    return
  }

  res.status(200).json({ ok: true, data: { config: config ?? null } })
}

// ──────────────────────────────────────────────────────────────────────────────
// PUT — upsert da configuração + seed de motivos se enabled: false → true
// ──────────────────────────────────────────────────────────────────────────────
async function handlePut(req: any, res: any, svc: any, companyId: string): Promise<void> {
  const body = req.body ?? {}

  // ── Validar e extrair apenas os campos permitidos ─────────────────────────
  const updates: Record<string, unknown> = {}

  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') {
      jsonError(res, 400, 'enabled deve ser boolean')
      return
    }
    updates.enabled = body.enabled
  }

  if ('eligibility_rule' in body) {
    if (typeof body.eligibility_rule !== 'string' || !VALID_ELIGIBILITY_RULES.has(body.eligibility_rule)) {
      jsonError(res, 400, `eligibility_rule inválido — valores aceitos: ${[...VALID_ELIGIBILITY_RULES].join(', ')}`)
      return
    }
    updates.eligibility_rule = body.eligibility_rule
  }

  if ('eligibility_hours' in body) {
    const hours = Number(body.eligibility_hours)
    if (!Number.isInteger(hours) || hours < 0) {
      jsonError(res, 400, 'eligibility_hours deve ser um inteiro não-negativo')
      return
    }
    updates.eligibility_hours = hours
  }

  if ('show_extra_questions' in body) {
    if (typeof body.show_extra_questions !== 'boolean') {
      jsonError(res, 400, 'show_extra_questions deve ser boolean')
      return
    }
    updates.show_extra_questions = body.show_extra_questions
  }

  if (Object.keys(updates).length === 0) {
    jsonError(res, 400, 'Nenhum campo válido fornecido para atualização')
    return
  }

  // ── Ler estado atual de `enabled` para detectar transição false/null → true ─
  const { data: current, error: readError } = await svc
    .from('company_contact_cycle_config')
    .select('enabled')
    .eq('company_id', companyId)
    .maybeSingle()

  if (readError) {
    console.error('[contact-cycles/config] PUT read error:', readError)
    jsonError(res, 500, 'Erro ao verificar configuração atual')
    return
  }

  const wasEnabled = current?.enabled ?? false
  const willEnable = updates.enabled === true

  // ── Upsert ────────────────────────────────────────────────────────────────
  const { data: config, error: upsertError } = await svc
    .from('company_contact_cycle_config')
    .upsert(
      { company_id: companyId, ...updates, updated_at: new Date().toISOString() },
      { onConflict: 'company_id', ignoreDuplicates: false }
    )
    .select('enabled, eligibility_rule, eligibility_hours, show_extra_questions, updated_at')
    .single()

  if (upsertError) {
    console.error('[contact-cycles/config] PUT upsert error:', upsertError)
    jsonError(res, 500, 'Erro ao salvar configuração')
    return
  }

  // ── Seed de motivos padrão se enabled transicionou de false/null → true ───
  // Guarda extra: verificar se já existem motivos antes de chamar seed.
  // Isso previne duplicatas enquanto a unique constraint (company_id, label)
  // não estiver aplicada na tabela contact_attempt_reasons.
  if (!wasEnabled && willEnable) {
    const { count: existingCount, error: countError } = await svc
      .from('contact_attempt_reasons')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)

    const hasNoReasons = !countError && (existingCount ?? 0) === 0

    if (hasNoReasons) {
      const { error: seedError } = await svc.rpc('seed_default_contact_attempt_reasons', {
        p_company_id: companyId,
      })
      if (seedError) {
        // Não bloqueia o fluxo — seed é best-effort
        console.warn('[contact-cycles/config] seed_default_contact_attempt_reasons error:', seedError)
      }
    }
  }

  res.status(200).json({ ok: true, data: { config } })
}
