// GET  /api/dashboard/tag-groups?company_id=UUID
// POST /api/dashboard/tag-groups
//
// Configuração da empresa para o card de grupos de tags.
// Grava somente tag_group_settings, company_id e updated_by.
// X-Tag-Groups-Schema identifica o contrato do cliente.
// Não autentica nem autoriza. Isso continua em authorizeTagGroups.
// A migration 20261008145217 precisa estar aplicada antes deste
// salvamento ir para um ambiente que consulta as métricas.
// A gravação é a função save_dashboard_tag_group_settings.
// Ela compara a revisão na mesma sentença e só altera tag_group_settings e updated_by.

import { logDashboardError } from '../lib/dashboard/observability.js'
import { jsonError } from '../lib/dashboard/auth.js'
import { authorizeTagGroups } from '../lib/dashboard/tagGroupAuth.js'
import {
  collectTagGroupTagIds,
  normalizeTagGroupSettings,
  validateTagGroupSettings,
  type TagGroupSettings,
} from '../lib/dashboard/tagGroupSettings.js'
import {
  TAG_GROUP_REVISION_CONFLICT_ERROR,
  TAG_GROUP_STALE_CLIENT_ERROR,
  classifyTagGroupSaveResponse,
  findUnavailableTagIds,
  isTagGroupSchemaClient,
  presentTagGroupSettings,
  tagGroupSchemaHeaderName,
} from '../lib/dashboard/tagGroupSave.js'

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

    const presented = presentTagGroupSettings(data?.tag_group_settings ?? null)
    return res.status(200).json({
      ok: true,
      data: presented.data,
      meta: {
        is_default: !data,
        updated_at: data?.updated_at as string | undefined,
        revision: presented.revision,
        schema: presented.schema,
        readable: presented.readable,
      },
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

    if (!isTagGroupSchemaClient(req.headers?.[tagGroupSchemaHeaderName()])) {
      res.status(409).json({
        ok: false,
        error: TAG_GROUP_STALE_CLIENT_ERROR,
        code: 'tag_groups_stale_client',
      })
      return
    }

    const shapeErr = validateTagGroupSettings(req.body?.tag_group_settings)
    if (shapeErr) { jsonError(res, 400, shapeErr); return }

    const requested = req.body.tag_group_settings as TagGroupSettings
    const settings = normalizeTagGroupSettings(requested, requested.revision + 1)
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

    const { data, error } = await actor.svc.rpc('save_dashboard_tag_group_settings', {
      p_company_id: payload.company_id,
      p_settings: payload.tag_group_settings,
      p_expected_revision: requested.revision,
      p_updated_by: payload.updated_by,
    })

    const parsed = typeof data === 'string' ? JSON.parse(data) : data
    const outcome = classifyTagGroupSaveResponse(error?.code, error ? null : parsed)
    if (outcome === 'invalid') {
      jsonError(res, 400, 'tag_group_settings: versão incompatível')
      return
    }
    if (outcome === 'conflict') {
      res.status(409).json({
        ok: false,
        error: TAG_GROUP_REVISION_CONFLICT_ERROR,
        code: 'tag_groups_revision_conflict',
      })
      return
    }
    if (outcome === 'error') {
      if (error) logDashboardError('dashboard.tag-groups.post', error, { companyId: actor.companyId })
      jsonError(res, 500, 'Erro ao salvar os grupos de tags')
      return
    }

    const saved = parsed as { tag_group_settings?: TagGroupSettings; updated_at?: string }
    return res.status(200).json({
      ok: true,
      data: saved.tag_group_settings,
      meta: {
        is_default: false,
        updated_at: saved.updated_at,
        revision: saved.tag_group_settings?.revision ?? settings.revision,
        schema: 2,
        readable: true,
      },
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
  const tagIds = collectTagGroupTagIds(settings)
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

  const missing = findUnavailableTagIds(tagIds, data ?? [])
  if (missing.length > 0) {
    jsonError(res, 400, 'tag_group_settings: tag inválida, inativa ou de outra empresa')
    return true
  }

  return false
}

type TagGroupActorSvc = {
  from: (table: string) => any
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string } | null }>
}
