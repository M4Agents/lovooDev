export const TASKLESS_LIST_LIMIT = 200
export const TASKLESS_STAGE_LIMIT = 200

const COMPANY_EDIT_ROLES = ['admin', 'super_admin', 'system_admin'] as const
const PARENT_EDIT_ROLES = ['super_admin', 'system_admin'] as const

export function canEditTasklessConfig(role: string | null | undefined): boolean {
  return !!role && (COMPANY_EDIT_ROLES as readonly string[]).includes(role)
}

export function canEditTasklessStages(input: {
  companyId: string | null | undefined
  parentCompanyId: string | null | undefined
  roles: Array<{ company_id: string; role: string; is_active?: boolean }>
}): boolean {
  if (!input.companyId) return false
  const active = input.roles.filter(role => role.is_active !== false)
  const direct = active.some(role =>
    role.company_id === input.companyId && canEditTasklessConfig(role.role)
  )
  if (direct) return true
  if (!input.parentCompanyId) return false
  return active.some(role =>
    role.company_id === input.parentCompanyId
    && (PARENT_EDIT_ROLES as readonly string[]).includes(role.role)
  )
}
