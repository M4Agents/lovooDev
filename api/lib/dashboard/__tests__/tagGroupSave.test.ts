import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALERT_SETTINGS_UPSERT_COLUMNS } from '../../../dashboard/alert-settings'
import {
  collectTagGroupTagIds,
  normalizeTagGroupSettings,
  validateTagGroupSettings,
  type TagGroupSettings,
} from '../tagGroupSettings'
import {
  TAG_GROUP_REVISION_CONFLICT_ERROR,
  classifyTagGroupSaveResponse,
  decideTagGroupRevision,
  findUnavailableTagIds,
  isEmptyLegacyTagGroups,
  isTagGroupSchemaClient,
  presentTagGroupSettings,
  readTagGroupRevision,
  storedRevisionMatches,
} from '../tagGroupSave'

const GROUP_1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const GROUP_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const BLOCK_1 = '12121212-1212-4121-8121-121212121212'
const BLOCK_2 = '13131313-1313-4131-8131-131313131313'
const BLOCK_3 = '14141414-1414-4141-8141-141414141414'
const BLOCK_4 = '15151515-1515-4151-8151-151515151515'
const BLOCK_5 = '16161616-1616-4161-8161-161616161616'
const TAG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TAG_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function tag(n: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12, '0')}`
}

function block(id: string, tagIds: string[]) {
  return { id, tag_ids: tagIds }
}

function document(groups: TagGroupSettings['groups'], revision = 0): TagGroupSettings {
  return { version: 2, revision, groups }
}

const oneGroup = document([{
  id: GROUP_1,
  name: 'Campanhas',
  blocks: [
    block(BLOCK_1, [TAG_A, TAG_B]),
    block(BLOCK_2, [TAG_C]),
  ],
}])

describe('contrato dos blocos', () => {
  it('lê {"groups":[]} como vazio e sem schema novo', () => {
    expect(isEmptyLegacyTagGroups({ groups: [] })).toBe(true)
    expect(readTagGroupRevision({ groups: [] })).toBe(0)
    expect(readTagGroupRevision(null)).toBe(0)
    expect(presentTagGroupSettings({ groups: [] })).toEqual({
      data: { groups: [] },
      revision: 0,
      schema: null,
      readable: true,
    })
    expect(validateTagGroupSettings({ groups: [] })).toMatch(/versão incompatível/)
    expect(validateTagGroupSettings(document([]))).toBeNull()
  })

  it('rejeita formato antigo, bloco vazio, limites e tag repetida no bloco', () => {
    expect(validateTagGroupSettings({
      version: 2,
      revision: 0,
      groups: [{ id: GROUP_1, name: 'Meta', tag_ids: [TAG_A] }],
    })).toMatch(/não permitido/)
    expect(validateTagGroupSettings(document([{
      id: GROUP_1,
      name: 'Meta',
      blocks: [block(BLOCK_1, [])],
    }]))).toMatch(/1 a 10/)
    expect(validateTagGroupSettings(document([{
      id: GROUP_1,
      name: 'Meta',
      blocks: [],
    }]))).toMatch(/pelo menos um bloco/)
    expect(validateTagGroupSettings(document([{
      id: GROUP_1,
      name: '  ',
      blocks: [block(BLOCK_1, [TAG_A])],
    }]))).toMatch(/nome/)
    expect(validateTagGroupSettings(document([{
      id: GROUP_1,
      name: 'Meta',
      blocks: [block(BLOCK_1, [TAG_A, TAG_A])],
    }]))).toMatch(/repetida no bloco/)
    expect(validateTagGroupSettings(document([{
      id: GROUP_1,
      name: 'Meta',
      blocks: [block(BLOCK_1, [TAG_A]), block(BLOCK_1, [TAG_B])],
    }]))).toMatch(/bloco repetido/)
    expect(validateTagGroupSettings(document([
      { id: GROUP_1, name: 'Um', blocks: [block(BLOCK_1, [TAG_A])] },
      { id: GROUP_1, name: 'Dois', blocks: [block(BLOCK_2, [TAG_B])] },
    ]))).toMatch(/grupo repetido/)
    expect(validateTagGroupSettings(document([{
      id: GROUP_1,
      name: 'Meta',
      blocks: [
        block(BLOCK_1, [TAG_A]),
        block(BLOCK_2, [TAG_B]),
        block(BLOCK_3, [TAG_C]),
        block(BLOCK_4, [TAG_A]),
        block(BLOCK_5, [TAG_B]),
      ],
    }]))).toMatch(/4 blocos/)
    expect(validateTagGroupSettings(document([{
      id: GROUP_1,
      name: 'Meta',
      blocks: [block(BLOCK_1, Array.from({ length: 11 }, (_, index) => tag(index + 1)))],
    }]))).toMatch(/1 a 10/)
    expect(validateTagGroupSettings({
      version: 2,
      revision: 0,
      groups: [],
      extra: true,
    })).toMatch(/não permitido/)
    expect(validateTagGroupSettings({
      version: 1,
      revision: 0,
      groups: [],
    })).toMatch(/versão incompatível/)
  })

  it('permite a mesma tag em blocos e grupos diferentes, sem união no grupo', () => {
    const settings = document([
      {
        id: GROUP_1,
        name: ' Grupo 1 ',
        blocks: [block(BLOCK_1, [TAG_A, TAG_B]), block(BLOCK_2, [TAG_A])],
      },
      {
        id: GROUP_2,
        name: 'Grupo 2',
        blocks: [block(BLOCK_3, [TAG_A, TAG_C])],
      },
    ])
    expect(validateTagGroupSettings(settings)).toBeNull()
    const normalized = normalizeTagGroupSettings(settings, 1)
    expect(normalized.groups[0].name).toBe('Grupo 1')
    expect(normalized.groups[0].blocks.map(item => item.tag_ids)).toEqual([[TAG_A, TAG_B], [TAG_A]])
    expect(normalized.groups[0]).not.toHaveProperty('tag_ids')
    expect(collectTagGroupTagIds(normalized)).toEqual([TAG_A, TAG_B, TAG_C])
  })

  it('tag inativa ou ausente da empresa continua indisponível', () => {
    expect(findUnavailableTagIds([TAG_A, TAG_B], [
      { id: TAG_A, is_active: true },
      { id: TAG_B, is_active: false },
    ])).toEqual([TAG_B])
    expect(findUnavailableTagIds([TAG_A, TAG_C], [
      { id: TAG_A, is_active: true },
    ])).toEqual([TAG_C])
  })
})

describe('clientes e revisão', () => {
  it('só conflito vira 409; falha de banco continua erro', () => {
    expect(classifyTagGroupSaveResponse(null, { ok: true, conflict: false })).toBe('ok')
    expect(classifyTagGroupSaveResponse(null, { ok: false, conflict: true })).toBe('conflict')
    expect(classifyTagGroupSaveResponse('22023', null)).toBe('invalid')
    expect(classifyTagGroupSaveResponse('23503', null)).toBe('error')
    expect(classifyTagGroupSaveResponse(null, null)).toBe('error')
    expect(classifyTagGroupSaveResponse(null, { ok: false, conflict: false })).toBe('error')
    expect(classifyTagGroupSaveResponse(null, { ok: false })).toBe('error')
  })

  it('cliente antigo não é aceito, mesmo com corpo novo', () => {
    expect(isTagGroupSchemaClient(undefined)).toBe(false)
    expect(isTagGroupSchemaClient('1')).toBe(false)
    expect(isTagGroupSchemaClient(['2', '2'])).toBe(false)
    expect(isTagGroupSchemaClient('2')).toBe(true)
  })

  it('duas telas com a mesma revisão: a segunda não produz gravação', () => {
    const first = decideTagGroupRevision({ groups: [] }, oneGroup)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.settings.revision).toBe(1)
    expect(first.settings.version).toBe(2)

    const second = decideTagGroupRevision(first.settings, { ...oneGroup, revision: 0 })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.status).toBe(409)
    expect(second.code).toBe('tag_groups_revision_conflict')
    expect(second.error).toBe(TAG_GROUP_REVISION_CONFLICT_ERROR)
    expect(second).not.toHaveProperty('settings')
  })

  it('documento ilegível não é sobrescrito pela revisão zero', () => {
    const stored = { groups: [{ id: GROUP_1, name: 'Antigo', tag_ids: [TAG_A] }] }
    expect(presentTagGroupSettings(stored).readable).toBe(false)
    const decision = decideTagGroupRevision(stored, oneGroup)
    expect(decision.ok).toBe(false)
  })

  it('o POST recusa o cliente antigo antes de gravar e usa a função atômica', () => {
    const source = readFileSync(resolve(process.cwd(), 'api/dashboard/tag-groups.ts'), 'utf8')
    const post = source.slice(source.indexOf('async function handlePost'))
    const authAt = post.indexOf('authorizeTagGroups')
    const guardAt = post.indexOf('isTagGroupSchemaClient')
    const writeAt = post.indexOf("rpc('save_dashboard_tag_group_settings'")
    expect(authAt).toBeGreaterThan(-1)
    expect(authAt).toBeLessThan(guardAt)
    expect(writeAt).toBeGreaterThan(guardAt)
    expect(post).toContain('company_id: actor.companyId')
    expect(post).toContain('p_company_id: payload.company_id')
    expect(post).not.toContain('.upsert(')
    expect(post).not.toContain('.update(')
    expect(source).toContain("['company_id', 'tag_group_settings', 'updated_by']")
    expect(post).not.toContain('sla_settings')
    expect(ALERT_SETTINGS_UPSERT_COLUMNS).not.toContain('tag_group_settings')

    const client = readFileSync(resolve(process.cwd(), 'src/services/dashboardApi.ts'), 'utf8')
    expect(client).toContain("'X-Tag-Groups-Schema': '2'")

    const modal = readFileSync(
      resolve(process.cwd(), 'src/components/Dashboard/sections/TagGroupsConfigModal.tsx'),
      'utf8',
    )
    const save = modal.slice(modal.indexOf('async function save'))
    const caught = save.slice(save.indexOf('catch (err'), save.indexOf('finally'))
    expect(caught).toContain('setDraftKept(true)')
    expect(caught).not.toContain('setGroups(')
    expect(caught).not.toContain('onClose()')
  })

  it('duas gravações com a mesma revisão não vencem juntas e preservam o alerta', async () => {
    const sla = { enabled: true, min_minutes: 240 }
    let row: { tag_group_settings: unknown; sla_settings: typeof sla } = {
      tag_group_settings: { groups: [] },
      sla_settings: sla,
    }
    let tail = Promise.resolve()

    function claim(expected: number, next: TagGroupSettings) {
      const job = tail.then(() => {
        if (!storedRevisionMatches(row.tag_group_settings, expected) || next.revision !== expected + 1) {
          return { ok: false as const, status: 409 as const }
        }
        row = { ...row, tag_group_settings: next }
        return { ok: true as const }
      })
      tail = job.then(() => undefined, () => undefined)
      return job
    }

    const firstDraft = document([{
      id: GROUP_1,
      name: 'Primeira tela',
      blocks: [block(BLOCK_1, [TAG_A])],
    }], 1)
    const secondDraft = document([{
      id: GROUP_2,
      name: 'Segunda tela',
      blocks: [block(BLOCK_2, [TAG_B])],
    }], 1)

    const [first, second] = await Promise.all([claim(0, firstDraft), claim(0, secondDraft)])
    const winners = [first, second].filter(item => item.ok)
    expect(winners).toHaveLength(1)
    expect(row.sla_settings).toEqual(sla)
    expect(row.tag_group_settings).toMatchObject({ version: 2, revision: 1 })
    expect(storedRevisionMatches(row.tag_group_settings, 0)).toBe(false)
    expect(storedRevisionMatches({ groups: [] }, 0)).toBe(true)
  })
})
