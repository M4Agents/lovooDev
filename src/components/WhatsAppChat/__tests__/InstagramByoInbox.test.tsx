// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramSidebarContent } from '../InstagramSidebarContent';
import { InstagramMainArea } from '../InstagramAreaRenderer';
import type { InstagramChatConversation } from '../../../types/instagram-chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../hooks/useAccessControl', () => ({
  useAccessControl: () => ({ canConnectInstagram: false }),
}));

vi.mock('../../../utils/instagram/computeConnectionHealth', () => ({
  computeConnectionHealth: () => ({ level: 'healthy' }),
}));

vi.mock('../ChatArea/InstagramChatArea', () => ({
  InstagramChatArea: ({
    connectionActive,
    byoConversation,
  }: {
    connectionActive: boolean
    byoConversation?: boolean
  }) => (
    <div
      data-testid="ig-composer"
      data-active={String(connectionActive)}
      data-byo={String(Boolean(byoConversation))}
    />
  ),
}));

const COMPANY = 'cccccccc-0000-4000-8000-000000000003';

function conversation(overrides: Partial<InstagramChatConversation>): InstagramChatConversation {
  return {
    id: 'conv-1',
    company_id: COMPANY,
    connection_id: '11111111-1111-4111-8111-111111111111',
    byo_account_id: null,
    byo_instagram_username: null,
    ig_thread_id: '1784',
    ig_participant_id: '1784',
    participant_name: 'Ana',
    participant_username: 'ana',
    participant_avatar: null,
    lead_id: null,
    status: 'active',
    unread_count: 0,
    last_message_preview: 'ola',
    last_message_at: null,
    assigned_to: null,
    created_at: '2026-10-30T00:00:00.000Z',
    updated_at: '2026-10-30T00:00:00.000Z',
    ...overrides,
  };
}

function sidebar(conversations: InstagramChatConversation[]) {
  return {
    connections: [],
    conversations,
    filteredConversations: conversations,
    selectedConnectionId: 'all',
    filter: { type: 'all' as const },
    loading: false,
    onSelectConnection: vi.fn(),
    onSelectConversation: vi.fn(),
    onFilterChange: vi.fn(),
    onRefresh: vi.fn(),
  };
}

describe('caixa Instagram com origem BYO', () => {
  afterEach(() => cleanup());

  it('mostra a conta BYO na lista existente sem conexão oficial', () => {
    render(
      <InstagramSidebarContent
        activeTab="all"
        igData={sidebar([conversation({
          connection_id: null,
          byo_account_id: '22222222-2222-4222-8222-222222222222',
          byo_instagram_username: 'usevalleron',
        })])}
      />,
    );
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.queryByText('Instagram BYO @usevalleron')).toBeNull();
    expect(screen.queryByText(/BYO|Oficial/)).toBeNull();
    expect(screen.queryByText('instagram.noAccounts')).toBeNull();
  });

  it('desabilita o compositor da conversa BYO e mantém o oficial ativo', () => {
    const chat = {
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
      connections: [{ id: '11111111-1111-4111-8111-111111111111', status: 'active' }],
      setSelectedConversation: vi.fn(),
    };
    const byo = conversation({
      connection_id: null,
      byo_account_id: '22222222-2222-4222-8222-222222222222',
      byo_instagram_username: 'usevalleron',
    });
    const official = conversation({ id: 'official-1' });
    const { rerender } = render(
      <InstagramMainArea
        companyId={COMPANY}
        activeTab="all"
        igCommentsData={{} as never}
        igChatDataRaw={chat}
        igSidebarData={{ ...sidebar([byo]), selectedConversationId: byo.id }}
      />,
    );
    expect(screen.getByTestId('ig-composer').getAttribute('data-active')).toBe('false');
    expect(screen.getByTestId('ig-composer').getAttribute('data-byo')).toBe('true');

    rerender(
      <InstagramMainArea
        companyId={COMPANY}
        activeTab="all"
        igCommentsData={{} as never}
        igChatDataRaw={chat}
        igSidebarData={{ ...sidebar([official]), selectedConversationId: official.id, connections: chat.connections as never }}
      />,
    );
    expect(screen.getByTestId('ig-composer').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('ig-composer').getAttribute('data-byo')).toBe('false');
  });

  it('não dispara outra página depois do erro e repete só pelo botão', () => {
    let constructed = 0
    class Observer {
      callback: IntersectionObserverCallback
      constructor(callback: IntersectionObserverCallback) {
        constructed += 1
        this.callback = callback
      }
      observe() {
        this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer)
    const onLoadMore = vi.fn()
    const onRetryPage = vi.fn()
    const { rerender } = render(
      <InstagramSidebarContent
        activeTab="all"
        igData={{
          ...sidebar([conversation({})]),
          hasMoreConversations: true,
          loadingMoreConversations: false,
          conversationPageError: true,
          onLoadMore,
          onRetryPage,
        }}
      />,
    )
    expect(constructed).toBe(0)
    expect(onLoadMore).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onRetryPage).toHaveBeenCalledTimes(1)

    rerender(
      <InstagramSidebarContent
        activeTab="all"
        igData={{
          ...sidebar([conversation({})]),
          hasMoreConversations: true,
          loadingMoreConversations: false,
          conversationPageError: false,
          onLoadMore,
          onRetryPage,
        }}
      />,
    )
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  });
});
