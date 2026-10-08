// Configuração dos grupos de tags do dashboard.
// version 2: blocks é a única regra.
// Dentro de cada bloco, basta uma tag (OU).
// O lead precisa cumprir todos os blocos (E).
// Não existe tag_ids no grupo. A união das tags não é regra.

export const TAG_GROUP_SCHEMA_VERSION = 2

export const TAG_GROUP_SCHEMA_HEADER = 'x-tag-groups-schema'

export const TAG_GROUP_LIMITS = {
  maxGroups: 8,
  maxBlocks: 4,
  minBlocks: 1,
  minTags: 1,
  maxTags: 10,
  maxNameLength: 40,
} as const

export const TAG_GROUP_EMPTY = { groups: [] as [] }

export const TAG_GROUP_VIEW_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

export function canViewTagGroups(role: string): boolean {
  return TAG_GROUP_VIEW_ROLES.has(role)
}

export function canConfigureTagGroups(role: string): boolean {
  return role === 'admin' || role === 'system_admin' || role === 'super_admin'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROOT_KEYS = new Set(['version', 'revision', 'groups'])
const GROUP_KEYS = new Set(['id', 'name', 'blocks'])
const BLOCK_KEYS = new Set(['id', 'tag_ids'])

export interface TagGroupBlock {
  id: string
  tag_ids: string[]
}

export interface TagGroupDefinition {
  id: string
  name: string
  blocks: TagGroupBlock[]
}

export interface TagGroupSettings {
  version: typeof TAG_GROUP_SCHEMA_VERSION
  revision: number
  groups: TagGroupDefinition[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function validateTagGroupSettings(value: unknown): string | null {
  if (!isPlainObject(value)) return 'tag_group_settings deve ser um objeto JSON'

  for (const key of Object.keys(value)) {
    if (!ROOT_KEYS.has(key)) return `tag_group_settings: campo não permitido "${key}"`
  }

  if (value.version !== TAG_GROUP_SCHEMA_VERSION) {
    return 'tag_group_settings: versão incompatível'
  }
  if (!isRevision(value.revision)) return 'tag_group_settings: revisão inválida'
  if (!Array.isArray(value.groups)) return 'tag_group_settings: "groups" deve ser um array'
  if (value.groups.length > TAG_GROUP_LIMITS.maxGroups) {
    return `tag_group_settings: no máximo ${TAG_GROUP_LIMITS.maxGroups} grupos`
  }

  const groupIds = new Set<string>()
  for (const group of value.groups) {
    const err = validateGroup(group, groupIds)
    if (err) return err
  }

  return null
}

function validateGroup(group: unknown, groupIds: Set<string>): string | null {
  if (!isPlainObject(group)) return 'tag_group_settings: cada grupo deve ser um objeto'

  for (const key of Object.keys(group)) {
    if (!GROUP_KEYS.has(key)) return `tag_group_settings: campo não permitido "${key}"`
  }

  if (typeof group.id !== 'string' || !UUID_RE.test(group.id)) {
    return 'tag_group_settings: id de grupo inválido'
  }
  if (groupIds.has(group.id)) return 'tag_group_settings: id de grupo repetido'
  groupIds.add(group.id)

  if (typeof group.name !== 'string') return 'tag_group_settings: nome do grupo inválido'
  const name = group.name.trim()
  if (!name || name.length > TAG_GROUP_LIMITS.maxNameLength) {
    return `tag_group_settings: o nome deve ter de 1 a ${TAG_GROUP_LIMITS.maxNameLength} caracteres`
  }

  if (!Array.isArray(group.blocks)) return 'tag_group_settings: "blocks" deve ser um array'
  if (group.blocks.length < TAG_GROUP_LIMITS.minBlocks) {
    return 'tag_group_settings: cada grupo precisa de pelo menos um bloco'
  }
  if (group.blocks.length > TAG_GROUP_LIMITS.maxBlocks) {
    return `tag_group_settings: no máximo ${TAG_GROUP_LIMITS.maxBlocks} blocos por grupo`
  }

  const blockIds = new Set<string>()
  for (const block of group.blocks) {
    const err = validateBlock(block, blockIds)
    if (err) return err
  }

  return null
}

function validateBlock(block: unknown, blockIds: Set<string>): string | null {
  if (!isPlainObject(block)) return 'tag_group_settings: cada bloco deve ser um objeto'

  for (const key of Object.keys(block)) {
    if (!BLOCK_KEYS.has(key)) return `tag_group_settings: campo não permitido "${key}"`
  }

  if (typeof block.id !== 'string' || !UUID_RE.test(block.id)) {
    return 'tag_group_settings: id de bloco inválido'
  }
  if (blockIds.has(block.id)) return 'tag_group_settings: id de bloco repetido'
  blockIds.add(block.id)

  if (!Array.isArray(block.tag_ids)) return 'tag_group_settings: "tag_ids" deve ser um array'
  if (block.tag_ids.length < TAG_GROUP_LIMITS.minTags || block.tag_ids.length > TAG_GROUP_LIMITS.maxTags) {
    return `tag_group_settings: cada bloco deve ter de ${TAG_GROUP_LIMITS.minTags} a ${TAG_GROUP_LIMITS.maxTags} tags`
  }

  const tags = new Set<string>()
  for (const tagId of block.tag_ids) {
    if (typeof tagId !== 'string' || !UUID_RE.test(tagId)) {
      return 'tag_group_settings: id de tag inválido'
    }
    if (tags.has(tagId)) return 'tag_group_settings: tag repetida no bloco'
    tags.add(tagId)
  }

  return null
}

export function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function normalizeTagGroupSettings(value: TagGroupSettings, revision: number): TagGroupSettings {
  return {
    version: TAG_GROUP_SCHEMA_VERSION,
    revision,
    groups: value.groups.map(group => ({
      id: group.id,
      name: group.name.trim(),
      blocks: group.blocks.map(block => ({
        id: block.id,
        tag_ids: [...block.tag_ids],
      })),
    })),
  }
}

export function collectTagGroupTagIds(settings: TagGroupSettings): string[] {
  return [...new Set(settings.groups.flatMap(group => group.blocks.flatMap(block => block.tag_ids)))]
}
