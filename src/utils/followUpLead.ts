export interface FollowUpLead {
  id: number
  name: string
  phone?: string
  email?: string
}

export type FollowUpLeadChoice =
  | { status: 'empty' }
  | { status: 'ready'; lead: FollowUpLead }
  | { status: 'fetch'; leadId: number }

export function normalizeFollowUpLead(value: unknown): FollowUpLead | null {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') return null
  const record = row as { id?: unknown; name?: unknown; phone?: unknown; email?: unknown }
  if (typeof record.id !== 'number' || typeof record.name !== 'string') return null
  const name = record.name.trim()
  if (!name) return null
  return {
    id: record.id,
    name,
    phone: typeof record.phone === 'string' && record.phone.trim() ? record.phone : undefined,
    email: typeof record.email === 'string' && record.email.trim() ? record.email : undefined,
  }
}

function sameLead(lead: FollowUpLead | null | undefined, leadId: number): FollowUpLead | null {
  return lead?.id === leadId ? lead : null
}

/** O lead da atividade concluída. Sem id, a nova atividade abre sem lead. */
export function chooseFollowUpLead(input: {
  leadId: number | null | undefined
  selected: FollowUpLead | null
  activityLead: unknown
  preSelected: FollowUpLead | null | undefined
}): FollowUpLeadChoice {
  const fromActivity = normalizeFollowUpLead(input.activityLead)
  const leadId = input.leadId ?? fromActivity?.id ?? null
  if (leadId == null) {
    if (input.selected) return { status: 'ready', lead: input.selected }
    return { status: 'empty' }
  }

  const ready = sameLead(input.selected, leadId)
    ?? sameLead(fromActivity, leadId)
    ?? sameLead(input.preSelected, leadId)
  if (ready) return { status: 'ready', lead: ready }
  return { status: 'fetch', leadId }
}
