// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstagramChatArea } from '../ChatArea/InstagramChatArea';
import type { InstagramChatConversation } from '../../../types/instagram-chat';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@emoji-mart/react', () => ({ default: () => null }));
vi.mock('@emoji-mart/data', () => ({ default: {} }));
vi.mock('../../../lib/supabase', () => ({
  supabase: { storage: { from: () => ({}) } },
}));
vi.mock('../ChatArea/InstagramSuggestionPanel', () => ({
  InstagramSuggestionPanel: () => null,
}));

const conversation = (byo: boolean): InstagramChatConversation => ({
  id: 'conv-1',
  company_id: 'cccccccc-0000-4000-8000-000000000003',
  connection_id: byo ? null : '11111111-1111-4111-8111-111111111111',
  byo_account_id: byo ? '22222222-2222-4222-8222-222222222222' : null,
  byo_instagram_username: byo ? 'usevalleron' : null,
  ig_thread_id: '1784',
  ig_participant_id: '1784',
  participant_name: 'Ana',
  participant_username: 'ana',
  participant_avatar: null,
  lead_id: null,
  status: 'active',
  unread_count: 0,
  last_message_preview: null,
  last_message_at: null,
  assigned_to: null,
  created_at: '2026-10-30T00:00:00.000Z',
  updated_at: '2026-10-30T00:00:00.000Z',
});

function renderArea(byo: boolean, connectionActive: boolean) {
  render(
    <InstagramChatArea
      conversation={conversation(byo)}
      messages={[]}
      messagesLoading={false}
      messagesError={undefined}
      sendLoading={false}
      sendMediaLoading={false}
      sendError={undefined}
      replyingTo={null}
      onSetReplyingTo={vi.fn()}
      onSendMessage={vi.fn()}
      onSendMedia={vi.fn()}
      onReactToMessage={vi.fn()}
      onRetryLoadMessages={vi.fn()}
      onClearSendError={vi.fn()}
      connectionActive={connectionActive}
      byoConversation={byo}
      companyId="cccccccc-0000-4000-8000-000000000003"
    />,
  );
}

describe('aviso do compositor Instagram', () => {
  afterEach(() => cleanup());

  it('mostra o aviso BYO sem reconexão oficial e sem campo de envio', () => {
    Element.prototype.scrollIntoView = vi.fn();
    renderArea(true, false);
    expect(screen.getAllByText('instagram.byoSendUnavailable')).toHaveLength(2);
    expect(screen.queryByText('instagram.reconnectLink')).toBeNull();
    expect(screen.queryByText('instagram.connectionInactiveBanner')).toBeNull();
    expect(screen.queryByPlaceholderText('Mensagem…')).toBeNull();
  });

  it('mantém o aviso e o link da conexão oficial inativa', () => {
    Element.prototype.scrollIntoView = vi.fn();
    renderArea(false, false);
    expect(screen.getByText('instagram.connectionInactiveBanner')).toBeTruthy();
    expect(screen.getByText('instagram.reconnectLink')).toBeTruthy();
    expect(screen.getByText('Conexão Instagram inativa. Vá em Configurações para reconectar.')).toBeTruthy();
    expect(screen.queryByText('instagram.byoSendUnavailable')).toBeNull();
    expect(screen.queryByPlaceholderText('Mensagem…')).toBeNull();
  });

  it('mantém o campo de envio da conversa oficial ativa', () => {
    Element.prototype.scrollIntoView = vi.fn();
    renderArea(false, true);
    expect(screen.getByPlaceholderText('Mensagem…')).toBeTruthy();
    expect(screen.queryByText('instagram.byoSendUnavailable')).toBeNull();
    expect(screen.queryByText('instagram.connectionInactiveBanner')).toBeNull();
  });

  it('traduz o aviso em pt-BR, en e es', () => {
    const read = (locale: string) => JSON.parse(readFileSync(resolve(`src/locales/${locale}/chat.json`), 'utf8'));
    expect(read('pt-BR').instagram.byoSendUnavailable).toBe('O envio de mensagens pelo Instagram ainda não está disponível.');
    expect(read('en').instagram.byoSendUnavailable).toBe('Sending messages through Instagram is not available yet.');
    expect(read('es').instagram.byoSendUnavailable).toBe('El envío de mensajes por Instagram todavía no está disponible.');
  });
});
