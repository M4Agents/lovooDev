import { describe, expect, it } from 'vitest'
import { presentInstagramAccounts, resolveInstagramChatSelection } from '../instagramChatSelection'
import type { InstagramByoChatAccount, InstagramConnection } from '../../../types/instagram-chat'

const REVOKED = '15e00e55-d0b9-4f8c-a518-f51b74b74e87'
const ACTIVE = '11111111-1111-4111-8111-111111111111'
const BYO = '3704590c-e4cb-438b-ac4c-3cec3c4b7a29'
const OTHER_BYO = '22222222-2222-4222-8222-222222222222'
const ACCOUNT = '17841408602689007'

function connection(overrides: Partial<InstagramConnection> & { company_id?: string } = {}): InstagramConnection & { company_id?: string } {
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

function byo(overrides: Partial<InstagramByoChatAccount> & { company_id?: string } = {}): InstagramByoChatAccount & { company_id?: string } {
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

describe('presentInstagramAccounts', () => {
  const PHOTO = 'https://cdn.example/usevalleron.jpg'
  const OTHER_PHOTO = 'https://cdn.example/outra.jpg'

  it('oculta a conexão inativa quando existe uma BYO da mesma identidade e reaproveita a foto', () => {
    const view = presentInstagramAccounts(
      [connection({ profile_picture_url: PHOTO })],
      [byo()],
    )
    expect(view.hiddenConnectionIds).toEqual([REVOKED])
    expect(view.photoByAccountId[BYO]).toBe(PHOTO)
  })

  it('mantém a conexão inativa sem correspondência e a conta sem foto', () => {
    const view = presentInstagramAccounts(
      [connection({ ig_webhook_id: 'outra-conta', instagram_user_id: '888' })],
      [byo()],
    )
    expect(view.hiddenConnectionIds).toEqual([])
    expect(view.photoByAccountId[BYO]).toBeNull()
  })

  it('não oculta quando a correspondência é ambígua ou as fotos divergem', () => {
    const ambiguous = presentInstagramAccounts(
      [connection({ profile_picture_url: PHOTO })],
      [byo(), byo({ id: OTHER_BYO })],
    )
    expect(ambiguous.hiddenConnectionIds).toEqual([])
    expect(ambiguous.photoByAccountId[BYO]).toBe(PHOTO)

    const conflict = presentInstagramAccounts(
      [
        connection({ profile_picture_url: PHOTO }),
        connection({ id: ACTIVE, status: 'expired', profile_picture_url: OTHER_PHOTO }),
      ],
      [byo()],
    )
    expect(conflict.hiddenConnectionIds).toEqual([REVOKED, ACTIVE])
    expect(conflict.photoByAccountId[BYO]).toBeNull()
  })

  it('não oculta conexão oficial ativa e não casa empresas diferentes nem username', () => {
    const active = presentInstagramAccounts(
      [connection({ id: ACTIVE, status: 'active', profile_picture_url: PHOTO })],
      [byo()],
    )
    expect(active.hiddenConnectionIds).toEqual([])
    expect(active.photoByAccountId[BYO]).toBe(PHOTO)

    const otherCompany = presentInstagramAccounts(
      [connection({ company_id: 'empresa-a', profile_picture_url: PHOTO })],
      [byo({ company_id: 'empresa-b' })],
    )
    expect(otherCompany.hiddenConnectionIds).toEqual([])
    expect(otherCompany.photoByAccountId[BYO]).toBeNull()

    const usernameOnly = presentInstagramAccounts(
      [connection({ ig_webhook_id: 'outra', instagram_user_id: '888', instagram_username: 'usevalleron' })],
      [byo()],
    )
    expect(usernameOnly.hiddenConnectionIds).toEqual([])
  })
})
