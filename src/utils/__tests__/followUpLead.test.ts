import { describe, expect, it } from 'vitest'
import { chooseFollowUpLead } from '../followUpLead'

const lead = { id: 10, name: 'Ana', phone: '11999999999' }

describe('chooseFollowUpLead', () => {
  it('reusa o lead já selecionado da atividade concluída', () => {
    expect(chooseFollowUpLead({
      leadId: 10,
      selected: lead,
      activityLead: null,
      preSelected: null,
    })).toEqual({ status: 'ready', lead })
  })

  it('usa o objeto da atividade e o lead recebido pela tela quando o id coincide', () => {
    expect(chooseFollowUpLead({
      leadId: 10,
      selected: null,
      activityLead: [{ id: 10, name: 'Ana', email: 'ana@exemplo.com' }],
      preSelected: null,
    })).toEqual({ status: 'ready', lead: { id: 10, name: 'Ana', email: 'ana@exemplo.com' } })

    expect(chooseFollowUpLead({
      leadId: 10,
      selected: null,
      activityLead: null,
      preSelected: lead,
    })).toEqual({ status: 'ready', lead })
  })

  it('pede a busca quando só existe o id', () => {
    expect(chooseFollowUpLead({
      leadId: 10,
      selected: null,
      activityLead: null,
      preSelected: { id: 99, name: 'Outro' },
    })).toEqual({ status: 'fetch', leadId: 10 })
  })

  it('abre sem lead quando a atividade concluída não tem lead', () => {
    expect(chooseFollowUpLead({
      leadId: null,
      selected: null,
      activityLead: null,
      preSelected: { id: 99, name: 'Outro' },
    })).toEqual({ status: 'empty' })
  })
})
