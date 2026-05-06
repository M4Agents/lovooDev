// =============================================================================
// GET  /api/integrations/message-templates?company_id=
// POST /api/integrations/message-templates
//
// Gestão de modelos de mensagem e categorias customizadas.
//
// GET — retorna categorias (system + custom da empresa) + templates ativos/inativos
// POST — cria template ou categoria custom
//
// Segurança:
//   - company_id vem do body/query mas é SEMPRE validado via assertMembership
//   - Escrita (POST) exige role admin-level (admin, system_admin, super_admin)
//   - channel = 'whatsapp_official_api' rejeitado com 422
//   - service_role usado apenas após validação de auth + membership
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'http'
import { getSupabaseAdmin }  from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

const WRITE_ROLES = ['admin', 'system_admin', 'super_admin']
const BLOCKED_CHANNELS = ['whatsapp_official_api']

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string>; body?: unknown },
  res: ServerResponse & { status: (c: number) => { json: (b: unknown) => void } },
): Promise<void> {
  if (req.method === 'GET')  return handleGet(req, res)
  if (req.method === 'POST') return handlePost(req, res)
  return jsonError(res, 405, 'Método não permitido')
}

// ---------------------------------------------------------------------------
// GET — lista categorias + templates
// ---------------------------------------------------------------------------

async function handleGet(req: any, res: any): Promise<void> {
  const token = extractToken(req.headers?.authorization)
  if (!token) return jsonError(res, 401, 'Token não fornecido')

  const svc = getSupabaseAdmin()

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) return jsonError(res, 401, 'Token inválido ou expirado')

  const companyId = req.query?.company_id as string | undefined
  if (!companyId) return jsonError(res, 400, 'company_id obrigatório')

  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')

  // Categorias da empresa (apenas custom — não há mais categorias system)
  const { data: categories, error: catErr } = await svc
    .from('message_template_categories')
    .select('id, company_id, name, is_system, sort_order, is_active')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (catErr) {
    console.error('[message-templates GET] categories error:', catErr)
    return jsonError(res, 500, 'Erro ao carregar categorias')
  }

  // Templates da empresa (todos os estados: ativos e inativos)
  const { data: templates, error: tplErr } = await svc
    .from('message_templates')
    .select('id, company_id, category_id, name, content, channel, is_active, created_by, created_at, updated_at')
    .eq('company_id', companyId)
    .order('name', { ascending: true })

  if (tplErr) {
    console.error('[message-templates GET] templates error:', tplErr)
    return jsonError(res, 500, 'Erro ao carregar templates')
  }

  return res.status(200).json({ categories: categories ?? [], templates: templates ?? [] })
}

// ---------------------------------------------------------------------------
// POST — cria template ou categoria custom
// ---------------------------------------------------------------------------

async function handlePost(req: any, res: any): Promise<void> {
  const token = extractToken(req.headers?.authorization)
  if (!token) return jsonError(res, 401, 'Token não fornecido')

  const svc = getSupabaseAdmin()

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) return jsonError(res, 401, 'Token inválido ou expirado')

  // Ler body
  const body = await readBody(req)
  const companyId = body?.company_id as string | undefined
  if (!companyId) return jsonError(res, 400, 'company_id obrigatório')

  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')

  // Apenas admin-level pode criar
  if (!WRITE_ROLES.includes(membership.role)) {
    return jsonError(res, 403, 'Permissão insuficiente para criar modelos')
  }

  const resource = body?.resource as string | undefined

  if (resource === 'category') {
    return createCategory(res, svc, companyId, body)
  }

  // Default: criar template
  return createTemplate(res, svc, companyId, user.id, body)
}

// ---------------------------------------------------------------------------
// Criar template
// ---------------------------------------------------------------------------

async function createTemplate(res: any, svc: any, companyId: string, userId: string, body: any): Promise<void> {
  const name       = (body?.name as string | undefined)?.trim()
  const content    = (body?.content as string | undefined)?.trim()
  const channel    = (body?.channel as string | undefined)?.trim() ?? 'whatsapp_life'
  const categoryId = body?.category_id as string | undefined

  if (!name)       return jsonError(res, 400, 'name obrigatório')
  if (!content)    return jsonError(res, 400, 'content obrigatório')
  if (!categoryId) return jsonError(res, 400, 'category_id obrigatório. Crie uma categoria antes de criar um modelo.')

  if (BLOCKED_CHANNELS.includes(channel)) {
    return jsonError(res, 422, 'Canal ainda não disponível.')
  }

  if (channel !== 'whatsapp_life') {
    return jsonError(res, 422, 'Canal inválido. Utilize whatsapp_life.')
  }

  // Validar que a categoria pertence à empresa — não confiar apenas no trigger
  const { data: cat } = await svc
    .from('message_template_categories')
    .select('id, company_id, is_active')
    .eq('id', categoryId)
    .eq('company_id', companyId)
    .eq('is_active', true)
    .maybeSingle()

  if (!cat) {
    return jsonError(res, 400, 'category_id inválido ou não pertence a esta empresa.')
  }

  const { data, error } = await svc
    .from('message_templates')
    .insert({
      company_id:  companyId,
      category_id: categoryId,
      name,
      content,
      channel,
      is_active:   true,
      created_by:  userId,
    })
    .select('id, company_id, category_id, name, content, channel, is_active, created_by, created_at, updated_at')
    .single()

  if (error) {
    console.error('[message-templates POST template] error:', error)
    return jsonError(res, 500, 'Erro ao criar template')
  }

  return res.status(201).json({ template: data })
}

// ---------------------------------------------------------------------------
// Criar categoria custom
// ---------------------------------------------------------------------------

async function createCategory(res: any, svc: any, companyId: string, body: any): Promise<void> {
  const name = (body?.name as string | undefined)?.trim()
  if (!name) return jsonError(res, 400, 'name obrigatório para categoria')

  const { data, error } = await svc
    .from('message_template_categories')
    .insert({
      company_id: companyId,
      name,
      is_system:  false,
      sort_order: body?.sort_order ?? 0,
      is_active:  true,
    })
    .select('id, company_id, name, is_system, sort_order, is_active')
    .single()

  if (error) {
    if (error.code === '23505') {
      return jsonError(res, 409, 'Já existe uma categoria com esse nome nesta empresa')
    }
    console.error('[message-templates POST category] error:', error)
    return jsonError(res, 500, 'Erro ao criar categoria')
  }

  return res.status(201).json({ category: data })
}

// ---------------------------------------------------------------------------
// Ler body (compatível com Vercel serverless)
// ---------------------------------------------------------------------------

async function readBody(req: any): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk: Buffer) => { raw += chunk.toString() })
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}
