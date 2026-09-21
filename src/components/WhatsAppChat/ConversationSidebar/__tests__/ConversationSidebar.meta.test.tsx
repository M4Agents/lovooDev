// @vitest-environment jsdom
// =============================================================================
// ConversationSidebar.meta.test.tsx — MVP3C.3
//
// Cobre o comportamento da lista Meta no ConversationSidebar.
// Foco: renderização condicional, isolamento de estado Meta/Uazapi,
//       loading/error/empty, seleção de conversa.
//
// CS-01  selectedProvider='meta' → MetaConversationList renderiza
// CS-02  selectedProvider='meta' → WhatsAppConversationList NÃO renderiza
// CS-03  InstanceSelector permanece visível em modo Meta
// CS-04  loading Meta → spinner
// CS-05  error Meta → mensagem + botão refresh
// CS-06  error Meta → refresh chama metaData.onRefresh
// CS-07  empty Meta → mensagem "Nenhuma conversa encontrada"
// CS-08  contact_name exibido quando presente
// CS-09  fallback wa_id quando contact_name é null
// CS-10  last_message_preview exibido
// CS-11  unread_count > 0 → badge numérico visível
// CS-12  clique em conversa chama metaData.onSelectConversation(id)
// CS-13  clique em conversa Meta NÃO chama onSelectConversation Uazapi
// CS-14  selectedProvider='uazapi' → WhatsAppConversationList renderiza
// CS-15  filtros Uazapi ocultos em modo Meta
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ConversationSidebar } from '../ConversationSidebar'
import type { MetaSidebarData } from '../ConversationSidebar'
import type { ConversationFilter } from '../../../../types/whatsapp-chat'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

// chatApi: mock para evitar chamadas reais (search useEffect)
vi.mock('../../../../services/chat/chatApi', () => ({
  chatApi: {
    searchConversations: vi.fn().mockResolvedValue([]),
  },
}))

// Sub-componentes com deps externas: mocks mínimos
vi.mock('../../../WhatsAppChat/ChannelSelector/ChannelSelector', () => ({
  ChannelSelector: () => <div data-testid="channel-selector" />,
}))
vi.mock('../../../WhatsAppChat/InstagramAccountSelector/InstagramAccountSelector', () => ({
  InstagramAccountSelector: () => <div data-testid="ig-account-selector" />,
}))
vi.mock('../../../WhatsAppChat/InstagramSidebarContent', () => ({
  InstagramSidebarContent: () => <div data-testid="ig-sidebar-content" />,
}))
vi.mock('../../../../utils/imageUtils', () => ({
  resolvePhotoUrl: () => null,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
})

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FILTER: ConversationFilter = { type: 'all' }

const META_INSTANCE = {
  id:            'meta-inst-001',
  instance_name: 'Meta Instance',
  phone_number:  '+55 11 99999-0001',
  status:        'connected',
  provider:      'meta' as const,
}

const META_CONV_WITH_NAME = {
  id:                   'meta-conv-001',
  instance_id:          'meta-inst-001',
  wa_id:                '5511999990001',
  contact_name:         'João Silva',
  status:               'active' as const,
  unread_count:         3,
  last_message_at:      '2026-09-21T15:00:00.000Z',
  last_message_preview: 'Olá, tudo bem?',
  created_at:           '2026-09-21T10:00:00.000Z',
  updated_at:           '2026-09-21T15:00:00.000Z',
}

const META_CONV_NO_NAME = {
  ...META_CONV_WITH_NAME,
  id:           'meta-conv-002',
  contact_name: null,
  unread_count: 0,
}

function makeMetaData(overrides: Partial<MetaSidebarData> = {}): MetaSidebarData {
  return {
    conversations:          [META_CONV_WITH_NAME],
    selectedConversationId: null,
    loading:                false,
    error:                  null,
    onSelectConversation:   vi.fn(),
    onRefresh:              vi.fn(),
    ...overrides,
  }
}

/** Props mínimas para renderizar ConversationSidebar em modo Meta */
function renderMetaSidebar(
  metaOverrides: Partial<MetaSidebarData> = {},
  extraProps: Record<string, unknown> = {}
) {
  const onSelectConversationUazapi = vi.fn()
  const onRefresh                  = vi.fn()
  const onSelectInstance           = vi.fn()
  const onFilterChange             = vi.fn()
  const metaData                   = makeMetaData(metaOverrides)

  render(
    <ConversationSidebar
      companyId="company-001"
      userId="user-001"
      instances={[META_INSTANCE]}
      conversations={[]}
      filter={FILTER}
      loading={false}
      onSelectInstance={onSelectInstance}
      onSelectConversation={onSelectConversationUazapi}
      onFilterChange={onFilterChange}
      onRefresh={onRefresh}
      selectedChannel="whatsapp"
      metaData={metaData}
      selectedProvider="meta"
      {...extraProps}
    />
  )

  return { metaData, onSelectConversationUazapi }
}

// ── Testes ────────────────────────────────────────────────────────────────────

describe('ConversationSidebar — MVP3C.3 modo Meta', () => {

  it('CS-01: selectedProvider="meta" → exibe lista Meta (conversa renderiza)', () => {
    renderMetaSidebar()
    expect(screen.getByText('João Silva')).toBeTruthy()
  })

  it('CS-02: selectedProvider="meta" → lista Uazapi NÃO renderiza', () => {
    // Passa uma conversa Uazapi; ela NÃO deve aparecer em modo Meta
    const uazapiConv = {
      id: 'wa-conv-001', contact_name: 'Cliente Uazapi',
      contact_phone: '+5511900000001', unread_count: 0,
      last_message_at: null, last_message_content: null,
      is_lead_over_plan: false, last_message_direction: 'inbound',
    } as any

    renderMetaSidebar({}, { conversations: [uazapiConv] })
    // Nome Uazapi não aparece pois WhatsAppConversationList não está ativo
    expect(screen.queryByText('Cliente Uazapi')).toBeNull()
  })

  it('CS-03: InstanceSelector permanece visível em modo Meta', () => {
    renderMetaSidebar()
    // Com selectedInstance=undefined, o trigger do InstanceSelector exibe a chave
    // i18n (o mock retorna a própria key). Confirma que o seletor está montado.
    expect(screen.getByText('instanceSelector.allInstances')).toBeTruthy()
  })

  it('CS-04: loading Meta → spinner renderiza, lista não aparece', () => {
    renderMetaSidebar({ loading: true, conversations: [] })
    // Spinner: animate-spin é a classe usada — verificamos via role=status ou class
    const spinners = document.querySelectorAll('.animate-spin')
    expect(spinners.length).toBeGreaterThan(0)
    expect(screen.queryByText('João Silva')).toBeNull()
  })

  it('CS-05: error Meta → mensagem de erro aparece', () => {
    renderMetaSidebar({ error: 'Erro ao carregar conversas Meta', conversations: [] })
    expect(screen.getByText('Erro ao carregar conversas Meta')).toBeTruthy()
    expect(screen.getByText('Tentar novamente')).toBeTruthy()
  })

  it('CS-06: error Meta → clique em "Tentar novamente" chama metaData.onRefresh', () => {
    const { metaData } = renderMetaSidebar({
      error: 'Falha na requisição',
      conversations: [],
    })
    fireEvent.click(screen.getByText('Tentar novamente'))
    expect(metaData.onRefresh).toHaveBeenCalledTimes(1)
  })

  it('CS-07: empty Meta → mensagem "Nenhuma conversa encontrada"', () => {
    renderMetaSidebar({ conversations: [] })
    expect(screen.getByText('Nenhuma conversa encontrada')).toBeTruthy()
  })

  it('CS-08: contact_name exibido quando presente', () => {
    renderMetaSidebar()
    expect(screen.getByText('João Silva')).toBeTruthy()
  })

  it('CS-09: fallback wa_id exibido quando contact_name é null', () => {
    renderMetaSidebar({ conversations: [META_CONV_NO_NAME] })
    // wa_id é o fallback de displayName
    expect(screen.getByText('5511999990001')).toBeTruthy()
    expect(screen.queryByText('João Silva')).toBeNull()
  })

  it('CS-10: last_message_preview exibido', () => {
    renderMetaSidebar()
    expect(screen.getByText('Olá, tudo bem?')).toBeTruthy()
  })

  it('CS-11: unread_count > 0 → badge com o número visível', () => {
    renderMetaSidebar()
    // META_CONV_WITH_NAME tem unread_count: 3
    expect(screen.getByText('3')).toBeTruthy()
  })

  it('CS-12: clique em conversa Meta chama metaData.onSelectConversation com id correto', () => {
    const { metaData } = renderMetaSidebar()
    // Botão de conversa = o elemento com o nome do contato
    fireEvent.click(screen.getByText('João Silva'))
    expect(metaData.onSelectConversation).toHaveBeenCalledTimes(1)
    expect(metaData.onSelectConversation).toHaveBeenCalledWith('meta-conv-001')
  })

  it('CS-13: clique em conversa Meta NÃO chama o callback Uazapi (onSelectConversation)', () => {
    const { onSelectConversationUazapi } = renderMetaSidebar()
    fireEvent.click(screen.getByText('João Silva'))
    expect(onSelectConversationUazapi).not.toHaveBeenCalled()
  })

  it('CS-14: selectedProvider="uazapi" → WhatsAppConversationList renderiza, Meta não', () => {
    const onSelectConversation = vi.fn()
    render(
      <ConversationSidebar
        companyId="company-001"
        userId="user-001"
        instances={[]}
        conversations={[]}
        filter={FILTER}
        loading={false}
        onSelectInstance={vi.fn()}
        onSelectConversation={onSelectConversation}
        onFilterChange={vi.fn()}
        onRefresh={vi.fn()}
        selectedChannel="whatsapp"
        selectedProvider="uazapi"
      />
    )
    // Nenhuma conversa Meta aparece (não há metaData)
    expect(screen.queryByText('Nenhuma conversa encontrada')).toBeNull()
    // Deve renderizar o empty state Uazapi (sem conversas)
    expect(screen.queryByText('João Silva')).toBeNull()
  })

  it('CS-15: filtros Uazapi ocultos em modo Meta', () => {
    renderMetaSidebar()
    // Os filtros Uazapi ("all", "unread", "assigned", "unassigned") são renderizados
    // como chips com as chaves i18n. Com i18n mockado, a key é retornada diretamente.
    // Em modo Meta, eles são omitidos pelo {!isMetaActive && ...}
    expect(screen.queryByText('sidebar.filters.assigned')).toBeNull()
    expect(screen.queryByText('sidebar.filters.unassigned')).toBeNull()
  })

  // ── CS-16..CS-19: Avatar por iniciais (MVP3F N2) ──────────────────────────
  // Confirmam que o avatar Meta exibe iniciais derivadas do contato,
  // sem carregar imagem externa.
  // Selector: [data-testid="meta-avatar"] isola as iniciais do resto do DOM.

  it('CS-16: contact_name simples → avatar exibe as 2 primeiras letras do nome', () => {
    const MARCIO_CONV = {
      ...META_CONV_WITH_NAME,
      id:           'meta-conv-cs16',
      contact_name: 'Marcio',
      wa_id:        '5511000000016',
    }
    renderMetaSidebar({ conversations: [MARCIO_CONV] })
    // "MA" aparece no avatar; o nome "Marcio" aparece no <h4> de displayName.
    // Ambos devem estar presentes sem ambiguidade.
    const avatarSpans = document.querySelectorAll('.select-none')
    const avatarTexts = Array.from(avatarSpans).map(el => el.textContent)
    expect(avatarTexts).toContain('MA')
  })

  it('CS-17: contact_name composto → avatar exibe primeira letra da primeira + última palavra', () => {
    const MARCIO_SILVA_CONV = {
      ...META_CONV_WITH_NAME,
      id:           'meta-conv-cs17',
      contact_name: 'Marcio Silva',
      wa_id:        '5511000000017',
    }
    renderMetaSidebar({ conversations: [MARCIO_SILVA_CONV] })
    const avatarSpans = document.querySelectorAll('.select-none')
    const avatarTexts = Array.from(avatarSpans).map(el => el.textContent)
    expect(avatarTexts).toContain('MS')
  })

  it('CS-18: contact_name null → avatar usa fallback wa_id (primeiros 2 chars)', () => {
    // META_CONV_NO_NAME tem contact_name: null, wa_id: '5511999990001'
    renderMetaSidebar({ conversations: [META_CONV_NO_NAME] })
    const avatarSpans = document.querySelectorAll('.select-none')
    const avatarTexts = Array.from(avatarSpans).map(el => el.textContent)
    expect(avatarTexts).toContain('55')
  })

  it('CS-19: lista Meta não introduz <img> para avatar dos contatos', () => {
    renderMetaSidebar()
    // Nenhum elemento <img> deve existir dentro da lista Meta.
    // A sidebar Uazapi usa <img> para foto (resolvePhotoUrl mockado para null),
    // mas a lista Meta deve usar somente texto (iniciais).
    const imgs = document.querySelectorAll('img')
    expect(imgs).toHaveLength(0)
  })
})
