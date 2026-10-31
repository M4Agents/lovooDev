import { describe, expect, it } from 'vitest'
import { resolveInstagramChatSelection } from '../instagramChatSelection'
import type { InstagramByoChatAccount, InstagramConnection } from '../../../types/instagram-chat'

const REVOKED = '15e00e55-d0b9-4f8c-a518-f51b74b74e87'
const ACTIVE = '11111111-1111-4111-8111-111111111111'
const BYO = '3704590c-e4cb-438b-ac4c-3cec3c4b7a29'
const OTHER_BYO = '22222222-2222-4222-8222-222222222222'
const ACCOUNT = '17841408602689007'

function connection(overrides: Partial<InstagramConnection>): InstagramConnection {
  return {
    id: REVOKED,
    instagram_user_id: '999',
    ig_webhook_id: ACCOUNT,
    instagram_username: 'usevalleron',
    profile_picture_url: null,
    status: 'revoked',
    scopes: null,
    token_expires_at: null,
    last_error_at: null,
    created_at: '2026-10-30T00:00:00.000Z',
    ...overrides,
  }
}

function byo(overrides: Partial<InstagramByoChatAccount> = {}): InstagramByoChatAccount {
  return { id: BYO, instagram_account_id: ACCOUNT, username: 'usevalleron', ...overrides }
}

describe('resolveInstagramChatSelection', () => {
  it('resolve a conexão revogada inequívoca para a BYO da mesma conta', () => {
    expect(resolveInstagramChatSelection(REVOKED, [connection({})], [byo()])).toBe(`byo:${BYO}`)
  })

  it('mantém a conexão oficial ativa', () => {
    expect(resolveInstagramChatSelection(
      ACTIVE,
      [connection({ id: ACTIVE, status: 'active', ig_webhook_id: '222' })],
      [byo()],
    )).toBe(`official:${ACTIVE}`)
  })

  it('cai em todas as contas quando a conexão revogada não tem BYO única', () => {
    expect(resolveInstagramChatSelection(REVOKED, [connection({})], [
      byo(),
      byo({ id: OTHER_BYO }),
    ])).toBe('all')
    expect(resolveInstagramChatSelection(REVOKED, [connection({})], [])).toBe('all')
  })

  it('não reaproveita conta de outra empresa nem texto inválido', () => {
    expect(resolveInstagramChatSelection(`byo:${OTHER_BYO}`, [connection({})], [byo()])).toBe('all')
    expect(resolveInstagramChatSelection('nao-e-uuid', [connection({})], [byo()])).toBe('all')
    expect(resolveInstagramChatSelection(REVOKED, [], [byo()])).toBe('all')
  })

  it('preserva all e byo já gravados desta empresa', () => {
    expect(resolveInstagramChatSelection('all', [connection({})], [byo()])).toBe('all')
    expect(resolveInstagramChatSelection(`byo:${BYO}`, [connection({})], [byo()])).toBe(`byo:${BYO}`)
  })
})
