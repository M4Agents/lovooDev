// =============================================================================
// PUT    /api/integrations/message-templates/:id
// DELETE /api/integrations/message-templates/:id
//
// Atualização e remoção (soft delete) de templates e categorias custom.
//
// Body PUT (template):   { company_id, name?, content?, channel?, category_id?, is_active?, resource: 'template' }
// Body PUT (categoria):  { company_id, name?, sort_order?, is_active?, resource: 'category' }
// Query DELETE:          ?company_id=&resource=template|category
//
// Segurança:
//   - company_id validado via assertMembership
//   - Escrita exige role admin-level
//   - channel = whatsapp_official_api rejeitado com 422
//   - Categorias system não podem ser editadas nem excluídas
//   - Soft delete: is_active = false (sem hard delete via API)
//   - Recurso deve pertencer à empresa (validação cruzada no banco)
// =============================================================================

import type { IncomingMessage, ServerResponse } from 'http'
import { getSupabaseAdmin } from '../../lib/automation/supabaseAdmin.js'
import {
  extractToken,
  assertMembership,
  jsonError,
} from '../../lib/dashboard/auth.js'

const WRITE_ROLES     = ['admin', 'system_admin', 'super_admin']
const BLOCKED_CHANNELS = ['whatsapp_official_api']

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export default async function handler(
  req: IncomingMessage & { query?: Record<string, string>; body?: unknown },
  res: ServerResponse & { status: (c: number) => { json: (b: unknown) => void } },
): Promise<void> {
  if (req.method === 'PUT')    return handlePut(req, res)
  if (req.method === 'DELETE') return handleDelete(req, res)
  return jsonError(res, 405, 'Método não permitido')
}

// ---------------------------------------------------------------------------
// PUT — atualizar template ou categoria
// ---------------------------------------------------------------------------

async function handlePut(req: any, res: any): Promise<void> {
  const token = extractToken(req.headers?.authorization)
  if (!token) return jsonError(res, 401, 'Token não fornecido')

  const svc = getSupabaseAdmin()

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) return jsonError(res, 401, 'Token inválido ou expirado')

  const id = req.query?.id as string | undefined
  if (!id) return jsonError(res, 400, 'id obrigatório')

  const body      = await readBody(req)
  const companyId = body?.company_id as string | undefined
  if (!companyId) return jsonError(res, 400, 'company_id obrigatório')

  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')
  if (!WRITE_ROLES.includes(membership.role)) {
    return jsonError(res, 403, 'Permissão insuficiente')
  }

  const resource = body?.resource as string | undefined

  if (resource === 'category') {
    return updateCategory(res, svc, id, companyId, body)
  }

  return updateTemplate(res, svc, id, companyId, body)
}

// ---------------------------------------------------------------------------
// Atualizar template
// ---------------------------------------------------------------------------

async function updateTemplate(res: any, svc: any, id: string, companyId: string, body: any): Promise<void> {
  // Confirmar que o template pertence à empresa
  const { data: existing } = await svc
    .from('message_templates')
    .select('id, company_id')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!existing) return jsonError(res, 404, 'Template não encontrado nesta empresa')

  const channel = body?.channel as string | undefined
  if (channel && BLOCKED_CHANNELS.includes(channel)) {
    return jsonError(res, 422, 'Canal ainda não disponível.')
  }
  if (channel && channel !== 'whatsapp_life') {
    return jsonError(res, 422, 'Canal inválido. Utilize whatsapp_life.')
  }

  const updates: Record<string, unknown> = {}
  if (body?.name    !== undefined) updates.name       = (body.name as string).trim()
  if (body?.content !== undefined) updates.content    = (body.content as string).trim()
  if (channel)                     updates.channel    = channel
  if (body?.category_id !== undefined) updates.category_id = body.category_id ?? null
  if (body?.is_active !== undefined)   updates.is_active   = Boolean(body.is_active)

  // Mídia: aceitar null explícito para remover
  if ('media_path' in (body ?? {})) updates.media_path = body.media_path ?? null
  if ('media_type' in (body ?? {})) updates.media_type = body.media_type ?? null

  if (updates.name    === '') return jsonError(res, 400, 'name não pode ser vazio')
  if (updates.content === '') return jsonError(res, 400, 'content não pode ser vazio')

  // Validar consistência de mídia após merge com existing
  const newPath = 'media_path' in updates ? updates.media_path : undefined
  const newType = 'media_type' in updates ? updates.media_type : undefined
  if (newPath !== undefined || newType !== undefined) {
    const resolvedPath = newPath !== undefined ? newPath : undefined // será checado contra o outro
    const resolvedType = newType !== undefined ? newType : undefined
    if (resolvedPath && !resolvedType) return jsonError(res, 400, 'media_type obrigatório quando media_path é informado')
    if (resolvedType && !resolvedPath) return jsonError(res, 400, 'media_path obrigatório quando media_type é informado')
    const VALID = ['image', 'video', 'document', 'audio']
    if (resolvedType && !VALID.includes(resolvedType as string)) {
      return jsonError(res, 400, `media_type inválido. Use: ${VALID.join(', ')}`)
    }
  }

  // category_id sendo alterado: validar que pertence à empresa — não confiar apenas no trigger
  if (updates.category_id !== undefined) {
    if (updates.category_id === null) {
      return jsonError(res, 400, 'category_id obrigatório. O modelo precisa ter uma categoria.')
    }
    const { data: cat } = await svc
      .from('message_template_categories')
      .select('id')
      .eq('id', updates.category_id as string)
      .eq('company_id', companyId)
      .eq('is_active', true)
      .maybeSingle()

    if (!cat) {
      return jsonError(res, 400, 'category_id inválido ou não pertence a esta empresa.')
    }
  }

  const { data, error } = await svc
    .from('message_templates')
    .update(updates)
    .eq('id', id)
    .eq('company_id', companyId)
    .select('id, company_id, category_id, name, content, channel, is_active, media_path, media_type, created_by, created_at, updated_at')
    .single()

  if (error) {
    console.error('[message-templates PUT template]', error)
    return jsonError(res, 500, 'Erro ao atualizar template')
  }

  return res.status(200).json({ template: data })
}

// ---------------------------------------------------------------------------
// Atualizar categoria custom
// ---------------------------------------------------------------------------

async function updateCategory(res: any, svc: any, id: string, companyId: string, body: any): Promise<void> {
  // Confirmar que a categoria é custom e pertence à empresa
  const { data: existing } = await svc
    .from('message_template_categories')
    .select('id, company_id, is_system')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError(res, 404, 'Categoria não encontrada')
  if (existing.is_system) return jsonError(res, 403, 'Categorias do sistema não podem ser editadas')
  if (existing.company_id !== companyId) return jsonError(res, 403, 'Acesso negado a esta categoria')

  const updates: Record<string, unknown> = {}
  if (body?.name       !== undefined) updates.name       = (body.name as string).trim()
  if (body?.sort_order !== undefined) updates.sort_order = Number(body.sort_order)
  if (body?.is_active  !== undefined) updates.is_active  = Boolean(body.is_active)

  if (updates.name === '') return jsonError(res, 400, 'name não pode ser vazio')

  const { data, error } = await svc
    .from('message_template_categories')
    .update(updates)
    .eq('id', id)
    .eq('company_id', companyId)
    .eq('is_system', false)
    .select('id, company_id, name, is_system, sort_order, is_active')
    .single()

  if (error) {
    if (error.code === '23505') {
      return jsonError(res, 409, 'Já existe uma categoria com esse nome nesta empresa')
    }
    console.error('[message-templates PUT category]', error)
    return jsonError(res, 500, 'Erro ao atualizar categoria')
  }

  return res.status(200).json({ category: data })
}

// ---------------------------------------------------------------------------
// DELETE — soft delete de template ou categoria
// ---------------------------------------------------------------------------

async function handleDelete(req: any, res: any): Promise<void> {
  const token = extractToken(req.headers?.authorization)
  if (!token) return jsonError(res, 401, 'Token não fornecido')

  const svc = getSupabaseAdmin()

  const { data: { user }, error: authErr } = await svc.auth.getUser(token)
  if (authErr || !user) return jsonError(res, 401, 'Token inválido ou expirado')

  const id        = req.query?.id as string | undefined
  const companyId = req.query?.company_id as string | undefined
  const resource  = req.query?.resource as string | undefined

  if (!id)        return jsonError(res, 400, 'id obrigatório')
  if (!companyId) return jsonError(res, 400, 'company_id obrigatório')

  const membership = await assertMembership(svc, user.id, companyId)
  if (!membership) return jsonError(res, 403, 'Acesso negado à empresa')
  if (!WRITE_ROLES.includes(membership.role)) {
    return jsonError(res, 403, 'Permissão insuficiente')
  }

  if (resource === 'category') {
    return deleteCategory(res, svc, id, companyId)
  }

  return deleteTemplate(res, svc, id, companyId)
}

// ---------------------------------------------------------------------------
// Soft delete de template (is_active = false)
// ---------------------------------------------------------------------------

async function deleteTemplate(res: any, svc: any, id: string, companyId: string): Promise<void> {
  const { data: existing } = await svc
    .from('message_templates')
    .select('id')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle()

  if (!existing) return jsonError(res, 404, 'Template não encontrado nesta empresa')

  const { error } = await svc
    .from('message_templates')
    .update({ is_active: false })
    .eq('id', id)
    .eq('company_id', companyId)

  if (error) {
    console.error('[message-templates DELETE template]', error)
    return jsonError(res, 500, 'Erro ao desativar template')
  }

  return res.status(200).json({ ok: true })
}

// ---------------------------------------------------------------------------
// Soft delete de categoria custom (is_active = false)
// ---------------------------------------------------------------------------

async function deleteCategory(res: any, svc: any, id: string, companyId: string): Promise<void> {
  const { data: existing } = await svc
    .from('message_template_categories')
    .select('id, company_id, is_system')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError(res, 404, 'Categoria não encontrada')
  if (existing.is_system) return jsonError(res, 403, 'Categorias do sistema não podem ser excluídas')
  if (existing.company_id !== companyId) return jsonError(res, 403, 'Acesso negado a esta categoria')

  const { error } = await svc
    .from('message_template_categories')
    .update({ is_active: false })
    .eq('id', id)
    .eq('company_id', companyId)
    .eq('is_system', false)

  if (error) {
    console.error('[message-templates DELETE category]', error)
    return jsonError(res, 500, 'Erro ao desativar categoria')
  }

  return res.status(200).json({ ok: true })
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
