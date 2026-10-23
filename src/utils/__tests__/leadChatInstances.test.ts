import { describe, expect, it } from 'vitest'
import {
  instancesVisibleInChat,
  leadInstanceOptions,
  type LeadChatInstance,
  type LeadConversationRef,
} from '../leadChatInstances'

const seller = { flag: true, role: 'seller', userId: 'seller-1' }
const admin = { flag: true, role: 'admin', userId: 'admin-1' }

function instance(overrides: Partial<LeadChatInstance> & Pick<LeadChatInstance, 'id'>): LeadChatInstance {
  return {
    instance_name: overrides.id,
    status: 'connected',
    assigned_user_id: null,
    available_to_all: false,
    ...overrides,
  }
}

function conversation(
  overrides: Partial<LeadConversationRef> & Pick<LeadConversationRef, 'id' | 'instance_id'>
): LeadConversationRef {
  return {
    assigned_to: 'seller-1',
    updated_at: '2026-10-23T12:00:00.000Z',
    ...overrides,
  }
}

const own = instance({ id: 'own', assigned_user_id: 'seller-1' })
const shared = instance({ id: 'shared', available_to_all: true, assigned_user_id: 'other' })
const privateOther = instance({ id: 'private', assigned_user_id: 'other' })

describe('instancesVisibleInChat', () => {
  it('limita o seller restrito à instância dele e às compartilhadas', () => {
    expect(instancesVisibleInChat([own, shared, privateOther], seller).map(item => item.id))
      .toEqual(['own', 'shared'])
  })

  it('mantém todas as instâncias para admin e para seller sem a flag', () => {
    expect(instancesVisibleInChat([own, privateOther], admin)).toHaveLength(2)
    expect(
      instancesVisibleInChat([own, privateOther], { flag: false, role: 'seller', userId: 'seller-1' })
    ).toHaveLength(2)
  })
})

describe('leadInstanceOptions', () => {
  const instances = [own, shared, privateOther]

  it('esconde a instância e a conversa que o seller não pode ver', () => {
    const options = leadInstanceOptions(
      [
        conversation({ id: 'c-own', instance_id: 'own', updated_at: '2026-10-23T10:00:00.000Z' }),
        conversation({ id: 'c-shared', instance_id: 'shared', assigned_to: 'seller-1' }),
        conversation({ id: 'c-private', instance_id: 'private', assigned_to: 'seller-1' }),
        conversation({ id: 'c-other', instance_id: 'shared', assigned_to: 'other-seller' }),
        conversation({ id: 'c-empty', instance_id: 'own', assigned_to: null }),
      ],
      instances,
      seller
    )

    expect(options.map(option => option.conversationId)).toEqual(['c-shared', 'c-own'])
  })

  it('abre a conversa mais recente e mostra as outras instâncias para o admin', () => {
    const options = leadInstanceOptions(
      [
        conversation({ id: 'older', instance_id: 'own', updated_at: '2026-10-20T10:00:00.000Z', assigned_to: null }),
        conversation({ id: 'newer', instance_id: 'private', updated_at: '2026-10-23T10:00:00.000Z', assigned_to: 'other-seller' }),
        conversation({ id: 'same-instance-old', instance_id: 'private', updated_at: '2026-10-01T10:00:00.000Z' }),
      ],
      instances,
      admin
    )

    expect(options.map(option => option.conversationId)).toEqual(['newer', 'older'])
  })

  it('ignora conversa cuja instância não veio na lista', () => {
    const options = leadInstanceOptions(
      [conversation({ id: 'gone', instance_id: 'deleted' })],
      instances,
      admin
    )

    expect(options).toEqual([])
  })
})
