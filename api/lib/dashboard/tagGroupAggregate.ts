// Semântica local das métricas de grupos de tags.
// A RPC get_dashboard_tag_group_metrics segue estas mesmas regras.
// O lead entra no grupo quando tem pelo menos uma tag de cada bloco.
// Várias tags do mesmo bloco contam uma vez.
//
// Coorte: leads da empresa, deleted_at nulo, created_at dentro do período UTC.
// Responsável: leads.responsible_user_id, só quando o filtro de vendedor vem preenchido.
// Oportunidade elegível: qualquer linha de opportunities da mesma empresa e do lead.
// Não existe deleted_at nem archived_at em opportunities.
// A data da venda não filtra a oportunidade.

export interface TagCohortLead {
  id: number
  companyId: string
  createdAt: string
  deletedAt: string | null
  responsibleUserId: string | null
  tagIds: string[]
}

export interface TagCohortOpportunity {
  leadId: number
  companyId: string
  status: string | null
  value: number | null
}

export interface KnownTag {
  id: string
  companyId: string
  isActive: boolean
}

export interface TagBlockInput {
  id: string
  tagIds: string[]
}

export interface TagGroupInput {
  id: string
  name: string
  blocks: TagBlockInput[] | null
}

export interface TagGroupAggregateRow {
  group_id: string
  name: string
  position: number
  status: 'ok' | 'invalid'
  invalid_tag_ids: string[]
  lead_count: number | null
  opps_generated: number | null
  leads_converted: number | null
  conversion_rate_pct: number | null
  total_won_value: number | null
}

export interface TagGroupCohort {
  companyId: string
  start: string
  end: string
  userId: string | null
  groups: TagGroupInput[]
  leads: TagCohortLead[]
  opportunities: TagCohortOpportunity[]
  knownTags: KnownTag[]
}

function tagIsAvailable(tagId: string, companyId: string, knownTags: KnownTag[]): boolean {
  const tag = knownTags.find(item => item.id === tagId)
  return !!tag && tag.companyId === companyId && tag.isActive === true
}

export function classifyTagGroup(
  group: TagGroupInput,
  companyId: string,
  knownTags: KnownTag[],
): { status: 'ok' | 'invalid'; invalidTagIds: string[] } {
  if (!group.blocks || group.blocks.length === 0) {
    return { status: 'invalid', invalidTagIds: [] }
  }

  const shapeBroken = group.blocks.some(block => {
    if (block.tagIds.length === 0) return true
    return new Set(block.tagIds).size !== block.tagIds.length
  })
  const seen = new Set<string>()
  const invalidTagIds: string[] = []
  for (const block of group.blocks) {
    for (const tagId of block.tagIds) {
      if (seen.has(tagId)) continue
      seen.add(tagId)
      if (!tagIsAvailable(tagId, companyId, knownTags)) invalidTagIds.push(tagId)
    }
  }
  if (shapeBroken || invalidTagIds.length > 0) {
    return { status: 'invalid', invalidTagIds }
  }
  return { status: 'ok', invalidTagIds: [] }
}

export function shouldScanLeads(cohort: Pick<TagGroupCohort, 'companyId' | 'groups' | 'knownTags'>): boolean {
  if (cohort.groups.length === 0) return false
  return cohort.groups.some(group => classifyTagGroup(group, cohort.companyId, cohort.knownTags).status === 'ok')
}

function inCohort(lead: TagCohortLead, cohort: TagGroupCohort): boolean {
  if (lead.companyId !== cohort.companyId) return false
  if (lead.deletedAt) return false
  if (lead.createdAt < cohort.start || lead.createdAt > cohort.end) return false
  if (cohort.userId && lead.responsibleUserId !== cohort.userId) return false
  return true
}

function matchesAllBlocks(lead: TagCohortLead, blocks: TagBlockInput[]): boolean {
  const owned = new Set(lead.tagIds)
  return blocks.every(block => block.tagIds.some(tagId => owned.has(tagId)))
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10
}

export function aggregateTagGroups(cohort: TagGroupCohort): TagGroupAggregateRow[] {
  if (cohort.groups.length === 0) return []

  const leads = shouldScanLeads(cohort) ? cohort.leads.filter(lead => inCohort(lead, cohort)) : []

  return cohort.groups.map((group, position) => {
    const classified = classifyTagGroup(group, cohort.companyId, cohort.knownTags)
    if (classified.status === 'invalid') {
      return {
        group_id: group.id,
        name: group.name,
        position,
        status: 'invalid',
        invalid_tag_ids: classified.invalidTagIds,
        lead_count: null,
        opps_generated: null,
        leads_converted: null,
        conversion_rate_pct: null,
        total_won_value: null,
      }
    }

    const matched = leads.filter(lead => matchesAllBlocks(lead, group.blocks ?? []))
    const matchedIds = new Set(matched.map(lead => lead.id))
    const opportunities = cohort.opportunities.filter(opp =>
      matchedIds.has(opp.leadId) && opp.companyId === cohort.companyId,
    )
    const wonByLead = new Set(
      opportunities.filter(opp => opp.status === 'won').map(opp => opp.leadId),
    )
    const leadCount = matched.length
    const wonValue = opportunities.reduce((sum, opp) => {
      if (opp.status !== 'won') return sum
      return sum + (opp.value ?? 0)
    }, 0)

    return {
      group_id: group.id,
      name: group.name,
      position,
      status: 'ok',
      invalid_tag_ids: [],
      lead_count: leadCount,
      opps_generated: opportunities.length,
      leads_converted: wonByLead.size,
      conversion_rate_pct: leadCount === 0 ? null : roundPct((wonByLead.size / leadCount) * 100),
      total_won_value: wonValue,
    }
  })
}
