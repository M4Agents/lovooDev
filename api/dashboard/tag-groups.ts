// GET  /api/dashboard/tag-groups?company_id=UUID
// POST /api/dashboard/tag-groups
//
// Configuração da empresa para o card de grupos de tags.
// O upsert grava somente tag_group_settings, company_id e updated_by.

import { logDashboardError } from '../lib/dashboard/observability.js'
import { jsonError } from '../lib/dashboard/auth.js'
import { authorizeTagGroups } from '../lib/dashboard/tagGroupAuth.js'
import {
  TAG_GROUP_DEFAULTS,
  normalizeTagGroupSettings,
  validateTagGroupSettings,
  type TagGroupSettings,
} from '../lib/dashboard/tagGroupSettings.js'

export const TAG_GROUP_UPSERT_COLUMNS = ['company_id', 'tag_group_settings', 'updated_by'] as const

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') { res.status(204).end(); return }
  if (req.method === 'GET') return handleGet(req, res)
  if (req.method === 'POST') return handlePost(req, res)
  jsonError(res, 405, 'Método não permitido')
}

async function handleGet(req: any, res: any): Promise<void> {
  try {
    const actor = await authorizeTagGroups(req, res, 'view')
    if (!actor) return

    const { data, error } = await actor.svc
      .from('dashboard_alert_settings')
      .select('tag_group_settings, updated_at')
      .eq('company_id', actor.companyId)
      .maybeSingle()

    if (error) {
      logDashboardError('dashboard.tag-groups.get', error, { companyId: actor.companyId })
      jsonError(res, 500, 'Erro ao buscar os grupos de tags')
      return
    }

    if (!data) {
      return res.status(200).json({
        ok: true,
        data: TAG_GROUP_DEFAULTS,
        meta: { is_default: true },
      })
    }

    return res.status(200).json({
      ok: true,
      data: (data.tag_group_settings as TagGroupSettings) ?? TAG_GROUP_DEFAULTS,
      meta: { is_default: false, updated_at: data.updated_at as string },
    })
  } catch (err: unknown) {
    logDashboardError('dashboard.tag-groups.get', err, { endpoint: '/api/dashboard/tag-groups' })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

async function handlePost(req: any, res: any): Promise<void> {
  try {
    const actor = await authorizeTagGroups(req, res, 'configure')
    if (!actor) return

    const shapeErr = validateTagGroupSettings(req.body?.tag_group_settings)
    if (shapeErr) { jsonError(res, 400, shapeErr); return }

    const settings = normalizeTagGroupSettings(req.body.tag_group_settings as TagGroupSettings)
    const tagErr = await assertTagsBelongToCompany(actor.svc, actor.companyId, settings, res)
    if (tagErr) return

    const payload = {
      company_id: actor.companyId,
      tag_group_settings: settings,
      updated_by: actor.user.id,
    }
    const extra = Object.keys(payload).filter(key => !(TAG_GROUP_UPSERT_COLUMNS as readonly string[]).includes(key))
    if (extra.length > 0) {
      jsonError(res, 500, 'payload de grupos altera coluna fora da lista permitida')
      return
    }

    const { data: saved, error } = await actor.svc
      .from('dashboard_alert_settings')
      .upsert(payload, { onConflict: 'company_id' })
      .select('tag_group_settings, updated_at')
      .single()

    if (error) {
      logDashboardError('dashboard.tag-groups.post', error, { companyId: actor.companyId })
      jsonError(res, 500, 'Erro ao salvar os grupos de tags')
      return
    }

    return res.status(200).json({
      ok: true,
      data: saved.tag_group_settings as TagGroupSettings,
      meta: { is_default: false, updated_at: saved.updated_at as string },
    })
  } catch (err: unknown) {
    logDashboardError('dashboard.tag-groups.post', err, { endpoint: '/api/dashboard/tag-groups' })
    jsonError(res, 500, 'Erro interno do servidor')
  }
}

async function assertTagsBelongToCompany(
  svc: TagGroupActorSvc,
  companyId: string,
  settings: TagGroupSettings,
  res: any,
): Promise<boolean> {
  const tagIds = [...new Set(settings.groups.flatMap(group => group.tag_ids))]
  if (tagIds.length === 0) return false

  const { data, error } = await svc
    .from('lead_tags')
    .select('id, is_active')
    .eq('company_id', companyId)
    .in('id', tagIds)

  if (error) {
    logDashboardError('dashboard.tag-groups.post.tags', error, { companyId })
    jsonError(res, 500, 'Erro ao validar tags')
    return true
  }

  const active = new Set((data ?? []).filter((tag: { id: string; is_active: boolean | null }) => tag.is_active === true).map((tag: { id: string }) => tag.id))
  const missing = tagIds.filter(id => !active.has(id))
  if (missing.length > 0) {
    jsonError(res, 400, 'tag_group_settings: tag inválida, inativa ou de outra empresa')
    return true
  }

  return false
}

type TagGroupActorSvc = {
  from: (table: string) => any
}
