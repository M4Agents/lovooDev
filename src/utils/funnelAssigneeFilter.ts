// =====================================================
// Filtro de responsável do lead no funil.
// '' = todos | 'unassigned' = sem responsável | UUID = um usuário.
// Não envia sentinela UUID. Sem responsável nunca cai na RPC antiga.
// =====================================================

export const UNASSIGNED_ASSIGNEE = 'unassigned'

export interface AssigneeRpcFilter {
  owner_user_id?: string
  unassigned_responsible: boolean
}

export function toAssigneeFilter(selectedOwner?: string): AssigneeRpcFilter {
  if (!selectedOwner) {
    return { unassigned_responsible: false }
  }
  if (selectedOwner === UNASSIGNED_ASSIGNEE) {
    return { unassigned_responsible: true }
  }
  return {
    owner_user_id: selectedOwner,
    unassigned_responsible: false,
  }
}

export function isValidAssigneeSelection(
  selectedOwner: string,
  ownerUserIds: readonly string[],
): boolean {
  if (!selectedOwner || selectedOwner === UNASSIGNED_ASSIGNEE) return true
  return ownerUserIds.includes(selectedOwner)
}
