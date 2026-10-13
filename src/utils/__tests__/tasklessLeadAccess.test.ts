import { describe, expect, it } from 'vitest'
import { canEditTasklessConfig, canEditTasklessStages } from '../tasklessLeadAccess'

const companyId = '11111111-1111-1111-1111-111111111111'
const parentId = '22222222-2222-2222-2222-222222222222'

describe('canEditTasklessConfig', () => {
  it('aceita admin, system_admin e super_admin', () => {
    expect(canEditTasklessConfig('admin')).toBe(true)
    expect(canEditTasklessConfig('system_admin')).toBe(true)
    expect(canEditTasklessConfig('super_admin')).toBe(true)
  })

  it('recusa manager, seller e partner', () => {
    expect(canEditTasklessConfig('manager')).toBe(false)
    expect(canEditTasklessConfig('seller')).toBe(false)
    expect(canEditTasklessConfig('partner')).toBe(false)
    expect(canEditTasklessConfig(null)).toBe(false)
  })
})

describe('canEditTasklessStages', () => {
  it('libera admin ativo da empresa e super_admin da pai', () => {
    expect(canEditTasklessStages({
      companyId,
      parentCompanyId: parentId,
      roles: [{ company_id: companyId, role: 'admin', is_active: true }],
    })).toBe(true)

    expect(canEditTasklessStages({
      companyId,
      parentCompanyId: parentId,
      roles: [{ company_id: parentId, role: 'super_admin', is_active: true }],
    })).toBe(true)
  })

  it('recusa manager, admin da pai e membership inativa', () => {
    expect(canEditTasklessStages({
      companyId,
      parentCompanyId: parentId,
      roles: [{ company_id: companyId, role: 'manager', is_active: true }],
    })).toBe(false)

    expect(canEditTasklessStages({
      companyId,
      parentCompanyId: parentId,
      roles: [{ company_id: parentId, role: 'admin', is_active: true }],
    })).toBe(false)

    expect(canEditTasklessStages({
      companyId,
      parentCompanyId: parentId,
      roles: [{ company_id: companyId, role: 'admin', is_active: false }],
    })).toBe(false)

    expect(canEditTasklessStages({
      companyId: null,
      parentCompanyId: parentId,
      roles: [{ company_id: parentId, role: 'super_admin', is_active: true }],
    })).toBe(false)
  })
})
