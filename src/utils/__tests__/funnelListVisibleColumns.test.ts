import { describe, expect, it } from 'vitest'
import { FUNNEL_CONSTANTS } from '../../types/sales-funnel'
import {
  buildFunnelListColumns,
  resolveListVisibleFieldSet,
} from '../funnelListVisibleColumns'

describe('resolveListVisibleFieldSet', () => {
  it('mantém valor, responsável e número quando a preferência é o default do card', () => {
    const fields = resolveListVisibleFieldSet([...FUNNEL_CONSTANTS.DEFAULT_VISIBLE_FIELDS])
    expect(fields.has('deal_value')).toBe(true)
    expect(fields.has('responsible')).toBe(true)
    expect(fields.has('opportunity_number')).toBe(true)
    expect(fields.has('phone')).toBe(true)
    expect(fields.has('company')).toBe(true)
  })

  it('respeita a preferência personalizada sem forçar colunas extras', () => {
    const fields = resolveListVisibleFieldSet(['name', 'email'])
    expect(fields.has('deal_value')).toBe(false)
    expect(fields.has('responsible')).toBe(false)
    expect(fields.has('opportunity_number')).toBe(false)
    expect(fields.has('email')).toBe(true)
    expect(fields.has('name')).toBe(true)
  })
})

describe('buildFunnelListColumns', () => {
  it('sempre inclui oportunidade, etapa, owner, dias e ações', () => {
    const { columns } = buildFunnelListColumns({
      canSelect: false,
      showCycleColumn: false,
      visibleFields: ['email'],
    })
    const ids = columns.map(column => column.id)
    expect(ids).toEqual(['opportunity', 'stage', 'owner', 'email', 'days_in_stage', 'actions'])
  })

  it('no default do card, mostra lista atual + telefone, empresa e foto', () => {
    const config = buildFunnelListColumns({
      canSelect: true,
      showCycleColumn: true,
      visibleFields: [...FUNNEL_CONSTANTS.DEFAULT_VISIBLE_FIELDS],
    })
    const ids = config.columns.map(column => column.id)
    expect(ids).toEqual([
      'select',
      'opportunity',
      'lead',
      'stage',
      'deal_value',
      'responsible',
      'owner',
      'phone',
      'company',
      'tags',
      'days_in_stage',
      'cycle',
      'actions',
    ])
    expect(config.showLeadPhoto).toBe(true)
    expect(config.showOpportunityNumber).toBe(true)
  })

  it('inclui coluna de campo personalizado na ordem da preferência', () => {
    const { columns } = buildFunnelListColumns({
      canSelect: false,
      showCycleColumn: false,
      visibleFields: ['name', 'cf_abc'],
      customFields: [{
        id: 'abc',
        company_id: 'c1',
        field_name: 'cpf',
        field_label: 'CPF',
        field_type: 'text',
        is_required: false,
        created_at: '',
        numeric_id: 1,
      }],
    })
    expect(columns.some(column => column.id === 'cf_abc' && column.customLabel === 'CPF')).toBe(true)
  })
})
