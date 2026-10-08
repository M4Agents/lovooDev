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
      groups: [{ id: GROUP_1, name: 'Meta', blocks: [{ id: 'b1', tagIds: [TAG_A] }] }],
      leads: [lead({ id: 1, tagIds: [TAG_A] }), lead({ id: 2, tagIds: [TAG_B] })],
    }))
    expect(rows[0].lead_count).toBe(1)
    expect(rows[0].conversion_rate_pct).toBe(0)
  })

  it('A E B exige uma tag de cada bloco', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [{
        id: GROUP_1,
        name: 'Meta e Instagram',
        blocks: [
          { id: 'b1', tagIds: [TAG_A] },
          { id: 'b2', tagIds: [TAG_B] },
        ],
      }],
      leads: [
        lead({ id: 1, tagIds: [TAG_A] }),
        lead({ id: 2, tagIds: [TAG_A, TAG_B] }),
      ],
    }))
    expect(rows[0].lead_count).toBe(1)
  })

  it('A OU B aceita qualquer tag do bloco e conta o lead uma vez', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [{
        id: GROUP_1,
        name: 'Origem',
        blocks: [{ id: 'b1', tagIds: [TAG_A, TAG_B] }],
      }],
      leads: [
        lead({ id: 1, tagIds: [TAG_A] }),
        lead({ id: 2, tagIds: [TAG_A, TAG_B] }),
        lead({ id: 3, tagIds: [TAG_C] }),
      ],
      opportunities: [
        { leadId: 2, companyId: COMPANY, status: 'won', value: 100 },
        { leadId: 2, companyId: COMPANY, status: 'won', value: 40 },
      ],
    }))
    expect(rows[0].lead_count).toBe(2)
    expect(rows[0].opps_generated).toBe(2)
    expect(rows[0].leads_converted).toBe(1)
    expect(rows[0].total_won_value).toBe(140)
  })

  it('(A OU B) E C deixa de fora quem cumpre só o primeiro bloco', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [{
        id: GROUP_1,
        name: 'Campanha',
        blocks: [
          { id: 'b1', tagIds: [TAG_A, TAG_B] },
          { id: 'b2', tagIds: [TAG_C] },
        ],
      }],
      leads: [
        lead({ id: 1, tagIds: [TAG_A] }),
        lead({ id: 2, tagIds: [TAG_B, TAG_C] }),
      ],
    }))
    expect(rows[0].lead_count).toBe(1)
  })

  it('(A OU B) E (C OU D) exige um bloco e o outro', () => {
    const tagD = 'abababab-abab-4aba-8aba-abababababab'
    const rows = aggregateTagGroups(cohort({
      knownTags: [...knownTags, { id: tagD, companyId: COMPANY, isActive: true }],
      groups: [{
        id: GROUP_1,
        name: 'Dois pares',
        blocks: [
          { id: 'b1', tagIds: [TAG_A, TAG_B] },
          { id: 'b2', tagIds: [TAG_C, tagD] },
        ],
      }],
      leads: [
        lead({ id: 1, tagIds: [TAG_A, tagD] }),
        lead({ id: 2, tagIds: [TAG_A, TAG_B] }),
      ],
    }))
    expect(rows[0].lead_count).toBe(1)
  })

  it('a mesma tag em dois blocos precisa cumprir os dois', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [{
        id: GROUP_1,
        name: 'Repetida',
        blocks: [
          { id: 'b1', tagIds: [TAG_A, TAG_B] },
          { id: 'b2', tagIds: [TAG_A] },
        ],
      }],
      leads: [
        lead({ id: 1, tagIds: [TAG_B] }),
        lead({ id: 2, tagIds: [TAG_A] }),
        lead({ id: 3, tagIds: [TAG_A, TAG_B] }),
      ],
      opportunities: [
        { leadId: 3, companyId: COMPANY, status: 'won', value: 50 },
      ],
    }))
    expect(rows[0].lead_count).toBe(2)
    expect(rows[0].opps_generated).toBe(1)
    expect(rows[0].total_won_value).toBe(50)
  })

  it('o mesmo lead entra nos dois grupos quando completa os dois conjuntos', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [
        { id: GROUP_1, name: 'Meta e Nativos', blocks: [{ id: 'b1', tagIds: [TAG_A] }, { id: 'b2', tagIds: [TAG_B] }] },
        { id: GROUP_2, name: 'Meta e Instagram', blocks: [{ id: 'b3', tagIds: [TAG_A] }, { id: 'b4', tagIds: [TAG_C] }] },
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
      groups: [{ id: GROUP_1, name: 'Meta', blocks: [{ id: 'b1', tagIds: [TAG_A] }] }],
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
      groups: [{ id: GROUP_1, name: 'Meta', blocks: [{ id: 'b1', tagIds: [TAG_A] }] }],
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
      groups: [{ id: GROUP_1, name: 'Meta', blocks: [{ id: 'b1', tagIds: [TAG_A] }] }],
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
      groups: [{ id: GROUP_1, name: 'Meta', blocks: [{ id: 'b1', tagIds: [TAG_A] }] }],
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
        { id: GROUP_1, name: 'Quebrado', blocks: [{ id: 'b1', tagIds: [TAG_A, TAG_B] }] },
        { id: GROUP_2, name: 'Valido', blocks: [{ id: 'b2', tagIds: [TAG_C] }] },
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
      groups: [{ id: GROUP_1, name: 'Quebrado', blocks: [{ id: 'b1', tagIds: [TAG_B] }] }],
      knownTags: [{ id: TAG_B, companyId: COMPANY, isActive: false }],
    }))).toBe(false)
  })

  it('bloco vazio, tag repetida ou formato sem blocks não vira uma regra mais fraca', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [
        { id: GROUP_1, name: 'Vazio', blocks: [{ id: 'b1', tagIds: [] }] },
        { id: GROUP_2, name: 'Repetida', blocks: [{ id: 'b2', tagIds: [TAG_A, TAG_A] }] },
        { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Antigo', blocks: null },
      ],
      leads: [lead({ id: 1, tagIds: [TAG_A] })],
    }))
    expect(rows.map(row => row.status)).toEqual(['invalid', 'invalid', 'invalid'])
    expect(rows.every(row => row.lead_count === null)).toBe(true)
  })

  it('tag de outra empresa invalida o grupo', () => {
    const rows = aggregateTagGroups(cohort({
      groups: [{ id: GROUP_1, name: 'Externa', blocks: [{ id: 'b1', tagIds: [TAG_A] }] }],
      knownTags: [{ id: TAG_A, companyId: OTHER, isActive: true }],
      leads: [lead({ id: 1, tagIds: [TAG_A] })],
    }))
    expect(rows[0].status).toBe('invalid')
    expect(rows[0].lead_count).toBeNull()
    expect(rows[0].invalid_tag_ids).toEqual([TAG_A])
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

  it('rejeita o formato antigo com tag_ids no grupo', () => {
    expect(validateTagGroupSettings({
      groups: [{ id: GROUP_1, name: 'Meta', tag_ids: [TAG_A] }],
    })).toMatch(/versão incompatível/)
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

describe('contrato da migration de blocos', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20261008145217_dashboard_tag_group_blocks.sql'),
    'utf8',
  )

  it('exige uma tag de cada bloco e não interpreta tag_ids do grupo', () => {
    expect(sql).toContain("(v_settings -> 'version') = '2'::jsonb")
    expect(sql).toContain('HAVING COUNT(DISTINCT blk.block_pos) = vg.block_count')
    expect(sql).toContain('l.deleted_at IS NULL')
    expect(sql).toContain('l.responsible_user_id')
    expect(sql).toContain('o.company_id = p_company_id')
    expect(sql).toContain("o.status = 'won'")
    expect(sql).toContain('GROUP BY o.lead_id')
    expect(sql).not.toContain('cardinality(vg.tag_ids)')
    expect(sql).not.toContain("item.grp -> 'tag_ids'")
    expect(sql).not.toContain('o.closed_at')
    expect(sql).not.toContain('o.created_at')
    expect(sql).not.toContain('ALTER TABLE')
    expect(sql).not.toMatch(/^CREATE INDEX/m)
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.get_dashboard_lead_origins')
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION public.get_dashboard_seller_ranking')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC')
    expect(sql).toContain('FROM anon')
    expect(sql).toContain('FROM authenticated')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_dashboard_tag_group_metrics(uuid, timestamptz, timestamptz, uuid) TO service_role')
    expect(sql).toContain('pelo menos uma tag de cada bloco')
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.save_dashboard_tag_group_settings')
    expect(sql).toContain('tag_group_settings = v_next')
    expect(sql).toContain("jsonb_set(")
    expect(sql).toContain('to_jsonb(p_expected_revision + 1)')
    expect(sql).toContain('OWNER TO postgres')
    expect(sql).toContain('updated_by = p_updated_by')
    expect(sql).toContain("tag_group_settings = '{\"groups\":[]}'::jsonb")
    expect(sql).toContain('WHEN unique_violation THEN')
    expect(sql).toContain("item.grp ? 'tag_ids'")
    expect(sql).not.toContain('sla_settings =')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.save_dashboard_tag_group_settings(uuid, jsonb, integer, uuid) TO service_role')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.save_dashboard_tag_group_settings(uuid, jsonb, integer, uuid) FROM authenticated')
  })
})
