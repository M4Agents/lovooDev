// Configuração dos grupos de tags do dashboard.
// A ordem do array é a ordem exibida.
// Uma tag pode existir em mais de um grupo.
// Dentro do grupo, o lead precisa ter todas as tags.

export const TAG_GROUP_LIMITS = {
  maxGroups: 8,
  minTags: 1,
  maxTags: 10,
  maxNameLength: 40,
} as const

export const TAG_GROUP_DEFAULTS = { groups: [] as TagGroupDefinition[] }

export const TAG_GROUP_VIEW_ROLES = new Set(['manager', 'admin', 'system_admin', 'super_admin'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ROOT_KEYS = new Set(['groups'])
const GROUP_KEYS = new Set(['id', 'name', 'tag_ids'])

export interface TagGroupDefinition {
  id: string
  name: string
  tag_ids: string[]
}

export interface TagGroupSettings {
  groups: TagGroupDefinition[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function canViewTagGroups(role: string): boolean {
  return TAG_GROUP_VIEW_ROLES.has(role)
}

export function canConfigureTagGroups(role: string): boolean {
  return role === 'admin' || role === 'system_admin' || role === 'super_admin'
}

export function validateTagGroupSettings(value: unknown): string | null {
  if (!isPlainObject(value)) return 'tag_group_settings deve ser um objeto JSON'

  for (const key of Object.keys(value)) {
    if (!ROOT_KEYS.has(key)) return `tag_group_settings: campo não permitido "${key}"`
  }

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

  if (!Array.isArray(group.tag_ids)) return 'tag_group_settings: "tag_ids" deve ser um array'
  if (group.tag_ids.length < TAG_GROUP_LIMITS.minTags || group.tag_ids.length > TAG_GROUP_LIMITS.maxTags) {
    return `tag_group_settings: cada grupo deve ter de ${TAG_GROUP_LIMITS.minTags} a ${TAG_GROUP_LIMITS.maxTags} tags`
  }

  const tags = new Set<string>()
  for (const tagId of group.tag_ids) {
    if (typeof tagId !== 'string' || !UUID_RE.test(tagId)) {
      return 'tag_group_settings: id de tag inválido'
    }
    if (tags.has(tagId)) return 'tag_group_settings: tag repetida no grupo'
    tags.add(tagId)
  }

  return null
}

export function normalizeTagGroupSettings(value: TagGroupSettings): TagGroupSettings {
  return {
    groups: value.groups.map(group => ({
      id: group.id,
      name: group.name.trim(),
      tag_ids: [...group.tag_ids],
    })),
  }
}
