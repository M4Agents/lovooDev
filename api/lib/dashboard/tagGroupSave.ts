// Proteção do POST de grupos de tags.
// O cliente já publicado não envia o cabeçalho de schema 2.
// Esse salvamento é recusado e a configuração permanece.
// A revisão esperada precisa ser a revisão lida. Quem perde a corrida
// recebe conflito e não grava.

import {
  TAG_GROUP_SCHEMA_HEADER,
  TAG_GROUP_SCHEMA_VERSION,
  isRevision,
  normalizeTagGroupSettings,
  type TagGroupSettings,
} from './tagGroupSettings.js'

export const TAG_GROUP_STALE_CLIENT_ERROR =
  'Esta tela está desatualizada e não pode salvar os grupos de tags. Atualize a página. A configuração não foi alterada.'

export const TAG_GROUP_REVISION_CONFLICT_ERROR =
  'Os grupos foram alterados em outra tela. A configuração salva não foi alterada.'

export function readSchemaHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null
  return typeof value === 'string' ? value : null
}

export function isTagGroupSchemaClient(value: string | string[] | undefined): boolean {
  return readSchemaHeader(value) === String(TAG_GROUP_SCHEMA_VERSION)
}

export function tagGroupSchemaHeaderName(): string {
  return TAG_GROUP_SCHEMA_HEADER
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function isEmptyLegacyTagGroups(stored: unknown): boolean {
  if (!isPlainObject(stored)) return false
  const keys = Object.keys(stored)
  return keys.length === 1 && keys[0] === 'groups' && Array.isArray(stored.groups) && stored.groups.length === 0
}

export function readTagGroupRevision(stored: unknown): number | null {
  if (stored == null) return 0
  if (isEmptyLegacyTagGroups(stored)) return 0
  if (!isPlainObject(stored) || !isRevision(stored.revision)) return null
  return stored.revision
}

export function isRenderableTagGroupSettings(stored: unknown): stored is TagGroupSettings {
  if (!isPlainObject(stored) || stored.version !== TAG_GROUP_SCHEMA_VERSION) return false
  if (!isRevision(stored.revision) || !Array.isArray(stored.groups)) return false
  return stored.groups.every(group => {
    if (!isPlainObject(group) || typeof group.id !== 'string' || typeof group.name !== 'string') return false
    if (!Array.isArray(group.blocks)) return false
    return group.blocks.every(block =>
      isPlainObject(block) && typeof block.id === 'string' && Array.isArray(block.tag_ids),
    )
  })
}

export interface PresentedTagGroups {
  data: TagGroupSettings | { groups: [] }
  revision: number | null
  schema: 2 | null
  readable: boolean
}

export function presentTagGroupSettings(stored: unknown): PresentedTagGroups {
  if (stored == null || isEmptyLegacyTagGroups(stored)) {
    return { data: { groups: [] }, revision: 0, schema: null, readable: true }
  }
  if (isRenderableTagGroupSettings(stored)) {
    return { data: stored, revision: stored.revision, schema: TAG_GROUP_SCHEMA_VERSION, readable: true }
  }
  return { data: { groups: [] }, revision: readTagGroupRevision(stored), schema: null, readable: false }
}

export type TagGroupRevisionDecision =
  | { ok: true; settings: TagGroupSettings }
  | { ok: false; status: 409; error: string; code: 'tag_groups_revision_conflict' }

export function storedRevisionMatches(stored: unknown, expectedRevision: number): boolean {
  if (!isRevision(expectedRevision)) return false
  if (expectedRevision === 0 && (stored == null || isEmptyLegacyTagGroups(stored))) return true
  if (!isPlainObject(stored) || !isRevision(stored.revision)) return false
  return stored.revision === expectedRevision
}

export function decideTagGroupRevision(
  stored: unknown,
  requested: TagGroupSettings,
): TagGroupRevisionDecision {
  if (!storedRevisionMatches(stored, requested.revision)) {
    return {
      ok: false,
      status: 409,
      error: TAG_GROUP_REVISION_CONFLICT_ERROR,
      code: 'tag_groups_revision_conflict',
    }
  }

  return {
    ok: true,
    settings: normalizeTagGroupSettings(requested, requested.revision + 1),
  }
}

export type TagGroupSaveClass = 'ok' | 'invalid' | 'conflict' | 'error'

export function classifyTagGroupSaveResponse(
  errorCode: string | null | undefined,
  data: unknown,
): TagGroupSaveClass {
  if (errorCode === '22023') return 'invalid'
  if (errorCode) return 'error'
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'error'
  const row = data as { ok?: unknown; conflict?: unknown }
  if (row.ok === false && row.conflict === true) return 'conflict'
  if (row.ok === true && row.conflict !== true) return 'ok'
  return 'error'
}

export function findUnavailableTagIds(
  requested: string[],
  rows: { id: string; is_active: boolean | null }[],
): string[] {
  const active = new Set(rows.filter(row => row.is_active === true).map(row => row.id))
  return requested.filter(id => !active.has(id))
}
