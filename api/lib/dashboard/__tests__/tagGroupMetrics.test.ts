import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALERT_SETTINGS_UPSERT_COLUMNS } from '../../../dashboard/alert-settings'
import {
  aggregateTagGroups,
  shouldScanLeads,
  type KnownTag,
  type TagCohortLead,
  type TagCohortOpportunity,
  type TagGroupCohort,
} from '../tagGroupAggregate'
import {
  canConfigureTagGroups,
  canViewTagGroups,
  validateTagGroupSettings,
} from '../tagGroupSettings'

const COMPANY = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const TAG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TAG_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const GROUP_1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const GROUP_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const SELLER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const START = '2026-10-01T00:00:00.000Z'
const END = '2026-10-08T00:00:00.000Z'

const knownTags: KnownTag[] = [
  { id: TAG_A, companyId: COMPANY, isActive: true },
  { id: TAG_B, companyId: COMPANY, isActive: true },
  { id: TAG_C, companyId: COMPANY, isActive: true },
]

function lead(partial: Partial<TagCohortLead> & Pick<TagCohortLead, 'id' | 'tagIds'>): TagCohortLead {
  return {
    companyId: COMPANY,
    createdAt: '2026-10-03T12:00:00.000Z',
    deletedAt: null,
    responsibleUserId: SELLER,
    ...partial,
  }
}

function cohort(partial: Partial<TagGroupCohort> = {}): TagGroupCohort {
  return {
    companyId: COMPANY,
    start: START,
    end: END,
    userId: null,
    groups: [],
    leads: [],
    opportunities: [],
    knownTags,
    ...partial,
  }
}

describe('grupos de tags', () => {
  it('grupo com uma tag conta o lead que tem essa tag', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [{ id: GROUP_1, name: 'Meta', tagIds: [TAG_A] }],
      leads: [lead({ id: 1, tagIds: [TAG_A] }), lead({ id: 2, tagIds: [TAG_B] })],
    }))
    expect(rows[0].lead_count).toBe(1)
    expect(rows[0].conversion_rate_pct).toBe(0)
  })

  it('grupo com duas tags exige as duas', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [{ id: GROUP_1, name: 'Meta e Instagram', tagIds: [TAG_A, TAG_B] }],
      leads: [
        lead({ id: 1, tagIds: [TAG_A] }),
        lead({ id: 2, tagIds: [TAG_A, TAG_B] }),
      ],
    }))
    expect(rows[0].lead_count).toBe(1)
  })

  it('o mesmo lead entra nos dois grupos quando completa os dois conjuntos', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [
        { id: GROUP_1, name: 'Meta e Nativos', tagIds: [TAG_A, TAG_B] },
        { id: GROUP_2, name: 'Meta e Instagram', tagIds: [TAG_A, TAG_C] },
      ],
      leads: [lead({ id: 1, tagIds: [TAG_A, TAG_B, TAG_C] })],
    }))
    expect(rows.map(row => row.lead_count)).toEqual([1, 1])
  })

  it('duas oportunidades ganhas contam um lead e somam a receita', () => {
    const opportunities: TagCohortOpportunity[] = [
      { leadId: 1, companyId: COMPANY, status: 'won', value: 100 },
      { leadId: 1, companyId: COMPANY, status: 'won', value: 40 },
    ]
    const rows = aggregateTagGroups(cohort({
      groups: [{ id: GROUP_1, name: 'Meta', tagIds: [TAG_A] }],
      leads: [lead({ id: 1, tagIds: [TAG_A] }), ...Array.from({ length: 9 }, (_, i) => lead({ id: i + 2, tagIds: [TAG_A] }))],
      opportunities,
    }))
    expect(rows[0].lead_count).toBe(10)
    expect(rows[0].leads_converted).toBe(1)
    expect(rows[0].conversion_rate_pct).toBe(10)
    expect(rows[0].opps_generated).toBe(2)
    expect(rows[0].total_won_value).toBe(140)
  })

  it('oportunidades abertas e perdidas entram na contagem e não na conversão', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [{ id: GROUP_1, name: 'Meta', tagIds: [TAG_A] }],
      leads: [lead({ id: 1, tagIds: [TAG_A] })],
      opportunities: [
        { leadId: 1, companyId: COMPANY, status: 'open', value: 80 },
        { leadId: 1, companyId: COMPANY, status: 'lost', value: 20 },
      ],
    }))
    expect(rows[0].opps_generated).toBe(2)
    expect(rows[0].leads_converted).toBe(0)
    expect(rows[0].conversion_rate_pct).toBe(0)
    expect(rows[0].total_won_value).toBe(0)
  })

  it('sem leads a conversão fica nula e sem grupos não varre a coorte', () => {
    const emptyGroup = aggregateTagGroups(cohort({
      groups: [{ id: GROUP_1, name: 'Meta', tagIds: [TAG_A] }],
    }))
    expect(emptyGroup[0].lead_count).toBe(0)
    expect(emptyGroup[0].conversion_rate_pct).toBeNull()
    expect(shouldScanLeads(cohort())).toBe(false)
    expect(aggregateTagGroups(cohort({
      leads: [lead({ id: 1, tagIds: [TAG_A] })],
    }))).toEqual([])
  })

  it('ignora lead excluído, fora do período, de outro responsável ou de outra empresa', () => {
    const rows = aggregateTagGroups(cohort({
      userId: SELLER,
      groups: [{ id: GROUP_1, name: 'Meta', tagIds: [TAG_A] }],
      leads: [
        lead({ id: 1, tagIds: [TAG_A] }),
        lead({ id: 2, tagIds: [TAG_A], deletedAt: '2026-10-04T00:00:00.000Z' }),
        lead({ id: 3, tagIds: [TAG_A], createdAt: '2026-09-01T00:00:00.000Z' }),
        lead({ id: 4, tagIds: [TAG_A], responsibleUserId: OTHER }),
        lead({ id: 5, tagIds: [TAG_A], companyId: OTHER }),
      ],
      opportunities: [
        { leadId: 1, companyId: OTHER, status: 'won', value: 999 },
      ],
    }))
    expect(rows[0].lead_count).toBe(1)
    expect(rows[0].leads_converted).toBe(0)
    expect(rows[0].total_won_value).toBe(0)
  })

  it('tag inativa deixa o grupo inválido e preserva a métrica como nula', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [
        { id: GROUP_1, name: 'Quebrado', tagIds: [TAG_A, TAG_B] },
        { id: GROUP_2, name: 'Valido', tagIds: [TAG_C] },
      ],
      knownTags: [
        { id: TAG_A, companyId: COMPANY, isActive: true },
        { id: TAG_B, companyId: COMPANY, isActive: false },
        { id: TAG_C, companyId: COMPANY, isActive: true },
      ],
      leads: [lead({ id: 1, tagIds: [TAG_A, TAG_B, TAG_C] })],
    }))
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].lead_count).toBeNull()
    expect(rows[0].invalid_tag_ids).toEqual([TAG_B])
    expect(rows[1].status).toBe('ok')
    expect(rows[1].lead_count).toBe(1)
    expect(shouldScanLeads(cohort({
      groups: [{ id: GROUP_1, name: 'Quebrado', tagIds: [TAG_B] }],
      knownTags: [{ id: TAG_B, companyId: COMPANY, isActive: false }],
    }))).toBe(false)
  })
})

describe('acesso e validação', () => {
  it('manager lê e não configura; seller e partner não acessam; admin configura', () => {
    expect(canViewTagGroups('manager')).toBe(true)
    expect(canConfigureTagGroups('manager')).toBe(false)
    expect(canViewTagGroups('seller')).toBe(false)
    expect(canConfigureTagGroups('seller')).toBe(false)
    expect(canViewTagGroups('partner')).toBe(false)
    expect(canConfigureTagGroups('admin')).toBe(true)
    expect(canConfigureTagGroups('system_admin')).toBe(true)
    expect(canConfigureTagGroups('super_admin')).toBe(true)
  })

  it('rejeita grupo sem tag, nome vazio, id repetido e tag repetida', () => {
    expect(validateTagGroupSettings({
      groups: [{ id: GROUP_1, name: '  ', tag_ids: [TAG_A] }],
    })).toMatch(/nome/)
    expect(validateTagGroupSettings({
      groups: [{ id: GROUP_1, name: 'Meta', tag_ids: [] }],
    })).toMatch(/1 a 10/)
    expect(validateTagGroupSettings({
      groups: [
        { id: GROUP_1, name: 'Um', tag_ids: [TAG_A] },
        { id: GROUP_1, name: 'Dois', tag_ids: [TAG_B] },
      ],
    })).toMatch(/repetido/)
    expect(validateTagGroupSettings({
      groups: [{ id: GROUP_1, name: 'Meta', tag_ids: [TAG_A, TAG_A] }],
    })).toMatch(/repetida/)
  })

  it('aceita a mesma tag em grupos diferentes e mantém a ordem do array', () => {
    const settings = {
      groups: [
        { id: GROUP_1, name: ' Grupo 1 ', tag_ids: [TAG_A, TAG_B] },
        { id: GROUP_2, name: 'Grupo 2', tag_ids: [TAG_A, TAG_C] },
      ],
    }
    expect(validateTagGroupSettings(settings)).toBeNull()
  })

  it('o salvamento de alertas não inclui tag_group_settings', () => {
    expect(ALERT_SETTINGS_UPSERT_COLUMNS).not.toContain('tag_group_settings')
    expect(ALERT_SETTINGS_UPSERT_COLUMNS).not.toContain('ranking_scope_settings')
  })
})

describe('contrato da migration', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261008131827_dashboard_tag_groups.sql'),
    'utf8',
  )

  it('restringe a função e não altera RPCs antigas', () => {
    expect(sql).toContain('l.deleted_at IS NULL')
    expect(sql).toContain('l.responsible_user_id')
    expect(sql).toContain('l.created_at >= p_start_date')
    expect(sql).toContain('l.created_at <= p_end_date')
    expect(sql).toContain('o.company_id = p_company_id')
    expect(sql).toContain("o.status = 'won'")
    expect(sql).toContain('COUNT(DISTINCT a.tag_id) = cardinality(vg.tag_ids)')
    expect(sql).not.toContain('o.closed_at')
    expect(sql).not.toContain('o.created_at')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC')
    expect(sql).toContain('FROM anon')
    expect(sql).toContain('FROM authenticated')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) TO service_role')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.get_dashboard_lead_origins')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.get_dashboard_seller_ranking')
    expect(sql).not.toMatch(/^CREATE INDEX/m)
  })
})
