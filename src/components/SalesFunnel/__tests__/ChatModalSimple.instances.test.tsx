// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LeadChatInstance, LeadConversationRef } from '../../../utils/leadChatInstances'

const auth = vi.hoisted(() => ({
  role: 'seller' as string | null,
  flag: true,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('../../WhatsAppChat/ChatArea/ChatArea', () => ({
  default: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="chat-area">{conversationId}</div>
  ),
}))

vi.mock('../../WhatsAppChat/LeadPanel/LeadPanel', () => ({
  default: () => <div data-testid="lead-panel" />,
}))

vi.mock('../../WhatsAppChat/InstanceSelector/InstanceAvatar', () => ({
  InstanceAvatar: () => <div />,
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    company: { id: 'company-1', chat_visibility_by_assigned_to: auth.flag },
    currentRole: auth.role,
  }),
}))

vi.mock('../../../services/chat/chatApi', () => ({
  chatApi: {
    listLeadChatsByInstance: vi.fn(),
    getConversationByLeadId: vi.fn(),
  },
}))

vi.mock('../../../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('../../../services/api', () => ({ api: {} }))
vi.mock('../../../services/automation/CRMService', () => ({ crmService: {} }))

import ChatModalSimple from '../ChatModalSimple'
import { chatApi } from '../../../services/chat/chatApi'

const conversations: LeadConversationRef[] = [
  { id: 'conv-own', instance_id: 'own', assigned_to: 'seller-1', updated_at: '2026-10-23T10:00:00.000Z' },
  { id: 'conv-shared', instance_id: 'shared', assigned_to: 'seller-1', updated_at: '2026-10-23T12:00:00.000Z' },
  { id: 'conv-private', instance_id: 'private', assigned_to: 'seller-1', updated_at: '2026-10-23T13:00:00.000Z' },
  { id: 'conv-other', instance_id: 'shared', assigned_to: 'other', updated_at: '2026-10-23T14:00:00.000Z' },
]

const instances: LeadChatInstance[] = [
  { id: 'own', instance_name: 'Minha', phone_number: '5511999990001', status: 'connected', assigned_user_id: 'seller-1', available_to_all: false },
  { id: 'shared', instance_name: 'Compartilhada', phone_number: '5511999990002', status: 'connected', assigned_user_id: 'other', available_to_all: true },
  { id: 'private', instance_name: 'Privada', phone_number: '5511999990003', status: 'connected', assigned_user_id: 'other', available_to_all: false },
]

function renderModal() {
  return render(
    <ChatModalSimple
      isOpen
      onClose={vi.fn()}
      leadId={10}
      companyId="company-1"
      userId="seller-1"
      closeLabel="Voltar"
    />
  )
}

beforeEach(() => {
  auth.role = 'seller'
  auth.flag = true
  vi.mocked(chatApi.listLeadChatsByInstance).mockResolvedValue({ conversations, instances })
})

afterEach(() => {
  cleanup()
})

describe('ChatModalSimple instâncias do lead', () => {
  it('abre a conversa mais recente visível e troca na mesma tela', async () => {
    renderModal()

    expect((await screen.findByTestId('chat-area')).textContent).toBe('conv-shared')
    expect(screen.getByText('Compartilhada')).toBeTruthy()
    expect(screen.queryByText('Privada')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Compartilhada/ }))
    fireEvent.click(screen.getByRole('button', { name: /Minha/ }))

    expect(screen.getByTestId('chat-area').textContent).toBe('conv-own')
    expect(screen.getByTestId('lead-panel')).toBeTruthy()
  })

  it('não mostra o seletor quando só existe uma conversa visível', async () => {
    vi.mocked(chatApi.listLeadChatsByInstance).mockResolvedValue({
      conversations: [conversations[0]],
      instances: [instances[0]],
    })

    renderModal()

    expect((await screen.findByTestId('chat-area')).textContent).toBe('conv-own')
    expect(screen.queryByText('Minha')).toBeNull()
  })

  it('mostra a instância privada para quem não é seller restrito', async () => {
    auth.role = 'admin'

    renderModal()

    expect((await screen.findByTestId('chat-area')).textContent).toBe('conv-other')
    fireEvent.click(screen.getByRole('button', { name: /Compartilhada/ }))
    expect(screen.getByText('Privada')).toBeTruthy()
    expect(screen.getByText('Minha')).toBeTruthy()
  })
})
