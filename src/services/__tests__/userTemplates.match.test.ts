import { describe, expect, it } from 'vitest'
import {
  applyTemplateToPermissions,
  findMatchingSystemTemplate,
  getSystemTemplates,
} from '../userTemplates'

const templateById = (id: string) => {
  const template = getSystemTemplates().find(item => item.id === id)
  if (!template) throw new Error(`Template ausente: ${id}`)
  return template
}

describe('findMatchingSystemTemplate', () => {
  it('reconhece o preset SDR gravado', () => {
    const permissions = applyTemplateToPermissions(templateById('system_vendedor_basico'))
    expect(findMatchingSystemTemplate('seller', permissions)?.id).toBe('system_vendedor_basico')
  })

  it('reconhece o preset Closer gravado, mesmo sem chaves false removidas pela RPC', () => {
    const permissions = applyTemplateToPermissions(templateById('system_vendedor_senior'))
    const { companies, impersonate, ...withoutStripped } = permissions
    expect(companies).toBe(false)
    expect(impersonate).toBe(false)
    expect(findMatchingSystemTemplate('seller', withoutStripped)?.id).toBe('system_vendedor_senior')
  })

  it('não trata permissões de Closer como SDR', () => {
    const stored = {
      chat: true,
      leads: true,
      users: false,
      settings: false,
      analytics: true,
      dashboard: true,
      financial: false,
      edit_users: false,
      create_leads: true,
      create_users: false,
      delete_users: false,
      export_leads: true,
      chat_own_leads: true,
      chat_templates: true,
      edit_all_leads: false,
      edit_financial: false,
      edit_own_leads: true,
      view_all_leads: false,
      view_financial: false,
      edit_team_leads: true,
      view_own_analytics: true,
      max_exports_per_day: 10,
      max_leads_per_month: 1000,
    }
    expect(findMatchingSystemTemplate('seller', stored)?.name).toBe('Closer')
  })
})
