// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InstagramAccountSelector } from '../InstagramAccountSelector/InstagramAccountSelector'
import { InstagramMainArea } from '../InstagramAreaRenderer'
import type { InstagramByoChatAccount, InstagramConnection } from '../../../types/instagram-chat'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('../../../hooks/useAccessControl', () => ({
  useAccessControl: () => ({ canConnectInstagram: false }),
}))

const ACCOUNT = '17841408602689007'
const REVOKED = '15e00e55-d0b9-4f8c-a518-f51b74b74e87'
const OTHER = '33333333-3333-4333-8333-333333333333'
const BYO = '3704590c-e4cb-438b-ac4c-3cec3c4b7a29'
const PHOTO = 'https://cdn.example/usevalleron.jpg'

function connection(overrides: Partial<InstagramConnection> = {}): InstagramConnection {
  return {
    id: REVOKED,
    instagram_user_id: '999',
    ig_webhook_id: ACCOUNT,
    instagram_username: 'usevalleron',
    profile_picture_url: PHOTO,
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

function openSelector(ui: ReactElement) {
  render(ui)
  fireEvent.click(screen.getByRole('button', { name: /usevalleron|Instagram|instagram.allAccounts/ }))
}

describe('apresentação da conta Instagram', () => {
  afterEach(() => cleanup())

  it('mostra @username e Instagram, com a foto da conexão correspondente, e mantém byo:', () => {
    const onSelectConnection = vi.fn()
    openSelector(
      <InstagramAccountSelector
        connections={[connection({})]}
        byoAccounts={[byo()]}
        selectedConnectionId={`byo:${BYO}`}
        onSelectConnection={onSelectConnection}
      />,
    )
    expect(screen.getAllByText('@usevalleron').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Instagram').length).toBeGreaterThan(0)
    expect(screen.queryByText(/BYO|Oficial/)).toBeNull()
    expect(screen.queryByText('Revogada')).toBeNull()
    expect(screen.queryByText('Reconexão necessária')).toBeNull()
    const photo = screen.getAllByRole('img')[0]
    expect(photo.getAttribute('src')).toBe(PHOTO)
    const rows = screen.getAllByRole('button').filter((button) => button.textContent?.includes('@usevalleron'))
    fireEvent.click(rows[rows.length - 1])
    expect(onSelectConnection).toHaveBeenCalledWith(`byo:${BYO}`)
  })

  it('mantém a conexão revogada sem correspondência e usa o avatar padrão sem foto', () => {
    openSelector(
      <InstagramAccountSelector
        connections={[connection({ ig_webhook_id: 'outra', instagram_user_id: '888', profile_picture_url: null })]}
        byoAccounts={[byo()]}
        selectedConnectionId="all"
        onSelectConnection={vi.fn()}
      />,
    )
    expect(screen.getByText('Reconexão necessária')).toBeTruthy()
    expect(screen.getByText('Revogada')).toBeTruthy()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('troca a foto por avatar padrão quando a imagem falha', () => {
    render(
      <InstagramAccountSelector
        connections={[connection({})]}
        byoAccounts={[byo()]}
        selectedConnectionId={`byo:${BYO}`}
        onSelectConnection={vi.fn()}
      />,
    )
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).toBeNull()
  })
})

describe('banner de reconexão em todas as contas', () => {
  afterEach(() => cleanup())

  function area(connections: InstagramConnection[], byoAccounts: InstagramByoChatAccount[]) {
    render(
      <InstagramMainArea
        companyId="empresa-a"
        activeTab="comments"
        igCommentsData={{ selectedComment: undefined } as never}
        igChatDataRaw={{
          messages: [],
          messagesLoading: false,
          sendLoading: false,
          sendMediaLoading: false,
          replyingTo: null,
          setReplyingTo: vi.fn(),
          sendMessage: vi.fn(),
          sendMedia: vi.fn(),
          reactToMessage: vi.fn(),
          clearSendError: vi.fn(),
          createLead: vi.fn(),
          createLeadLoading: false,
          clearCreateLeadError: vi.fn(),
          connections,
          setSelectedConversation: vi.fn(),
        }}
        igSidebarData={{
          connections,
          byoAccounts,
          conversations: [],
          filteredConversations: [],
          selectedConnectionId: 'all',
          filter: { type: 'all' },
          loading: false,
          onSelectConnection: vi.fn(),
          onSelectConversation: vi.fn(),
          onFilterChange: vi.fn(),
          onRefresh: vi.fn(),
        }}
      />,
    )
  }

  it('ignora a conexão revogada já substituída e preserva outra conexão revogada', () => {
    area([connection({})], [byo()])
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    area([
      connection({}),
      connection({
        id: OTHER,
        instagram_user_id: '777',
        ig_webhook_id: 'conta-sem-byo',
        instagram_username: 'outra',
      }),
    ], [byo()])
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
