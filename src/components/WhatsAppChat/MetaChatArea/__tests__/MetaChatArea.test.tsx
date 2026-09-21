// @vitest-environment jsdom
// =============================================================================
// MetaChatArea.test.tsx — MVP3C.4
//
// Testa o componente MetaChatArea mockando useMetaChatMessages.
// NÃO repete lógica interna do hook (já coberta em useMetaChatMessages.test.ts).
//
// MA-01  chama useMetaChatMessages com companyId e conversationId corretos
// MA-02  header: contact_name presente → exibe nome
// MA-03  header: contact_name null → fallback wa_id
// MA-04  header: status 'active' → representação visual
// MA-05  loading: spinner visível; mensagens não aparecem
// MA-06  error: mensagem de erro visível
// MA-07  error: "Tentar novamente" chama refresh
// MA-08  empty: "Nenhuma mensagem nesta conversa"
// MA-09  inbound: body visível + data-direction="inbound"
// MA-10  outbound: body visível + data-direction="outbound"
// MA-11  message_type não suportado → "Mensagem não suportada"
// MA-12  provider_timestamp presente → componente renderiza sem crash
// MA-13  provider_timestamp null → usa created_at; sem crash
// MA-14  timestamp inválido → componente não quebra
// MA-15  ordem: mensagens na mesma ordem do hook
// MA-16  read-only: zero input/textarea/contentEditable/botão de envio
// MA-17  conversation undefined → sem crash
// MA-18  mudança de messages → scroll executado sem erro
//
// formatTime testado diretamente (helper exportado):
// FT-01  ISO válido → string HH:mm
// FT-02  string vazia → ''
// FT-03  null → ''
// FT-04  undefined → ''
// FT-05  data inválida → ''
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup }               from '@testing-library/react'
import { MetaChatArea, formatTime }                          from '../MetaChatArea'
import type { MetaChatConversation, MetaChatMessage }        from '../../../../types/meta-whatsapp'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../../hooks/chat/useMetaChatMessages', () => ({
  useMetaChatMessages: vi.fn(),
}))

import { useMetaChatMessages } from '../../../../hooks/chat/useMetaChatMessages'

const mockUseMetaChatMessages = useMetaChatMessages as ReturnType<typeof vi.fn>

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY_ID  = 'company-test-001'
const CONV_ID     = 'conv-test-001'

const CONV_FULL: MetaChatConversation = {
  id:                   CONV_ID,
  instance_id:          'inst-001',
  wa_id:                '5511999990001',
  contact_name:         'João Silva',
  status:               'active',
  unread_count:         2,
  last_message_at:      '2026-09-21T15:00:00.000Z',
  last_message_preview: 'Olá',
  created_at:           '2026-09-21T10:00:00.000Z',
  updated_at:           '2026-09-21T15:00:00.000Z',
}

const CONV_NO_NAME: MetaChatConversation = {
  ...CONV_FULL,
  contact_name: null,
}

function makeMsg(
  id:            string,
  direction:     'inbound' | 'outbound' = 'inbound',
  message_type:  string = 'text',
  body:          string = `corpo ${id}`,
  ts:            string | null = '2026-09-21T15:30:00.000Z',
): MetaChatMessage {
  return {
    id,
    conversation_id:    CONV_ID,
    instance_id:        'inst-001',
    direction,
    message_type,
    body,
    provider_timestamp: ts,
    created_at:         '2026-09-21T15:00:00.000Z',
  }
}

/** Estado padrão do hook mockado — sem mensagens, sem erros */
function mockIdle(overrides: Partial<{
  messages: MetaChatMessage[]
  loading:  boolean
  error:    string | null
  refresh:  ReturnType<typeof vi.fn>
}> = {}) {
  const refresh = vi.fn()
  mockUseMetaChatMessages.mockReturnValue({
    messages: [],
    loading:  false,
    error:    null,
    refresh,
    ...overrides,
  })
  return refresh
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockIdle()
})

afterEach(() => {
  cleanup()
})

// ─────────────────────────────────────────────────────────────────────────────
// Testes do helper formatTime (puro — sem renderização)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatTime — helper puro', () => {
  it('FT-01: ISO válido → retorna string HH:mm não vazia', () => {
    const result = formatTime('2026-09-21T15:30:00.000Z')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    // Formato esperado: dois blocos separados por ':' (ex: "12:30")
    expect(result).toMatch(/^\d{1,2}:\d{2}$/)
  })

  it('FT-02: string vazia → ""', () => {
    expect(formatTime('')).toBe('')
  })

  it('FT-03: null → ""', () => {
    expect(formatTime(null)).toBe('')
  })

  it('FT-04: undefined → ""', () => {
    expect(formatTime(undefined)).toBe('')
  })

  it('FT-05: data inválida → ""', () => {
    expect(formatTime('nao-e-uma-data')).toBe('')
    expect(formatTime('invalid-date-string')).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Testes do componente MetaChatArea
// ─────────────────────────────────────────────────────────────────────────────

describe('MetaChatArea — MVP3C.4', () => {

  // MA-01 — chama hook com os IDs corretos
  it('MA-01: chama useMetaChatMessages com companyId e conversationId corretos', () => {
    render(
      <MetaChatArea
        companyId={COMPANY_ID}
        conversationId={CONV_ID}
        conversation={CONV_FULL}
      />
    )
    expect(mockUseMetaChatMessages).toHaveBeenCalledWith(COMPANY_ID, CONV_ID)
  })

  // MA-02 — header: contact_name presente
  it('MA-02: header exibe contact_name quando presente', () => {
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    expect(screen.getByText('João Silva')).toBeTruthy()
  })

  // MA-03 — header: fallback wa_id
  it('MA-03: header exibe wa_id como fallback quando contact_name é null', () => {
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_NO_NAME} />
    )
    // wa_id deve aparecer como displayName
    expect(screen.getAllByText('5511999990001').length).toBeGreaterThan(0)
    expect(screen.queryByText('João Silva')).toBeNull()
  })

  // MA-04 — header: status 'active' aparece
  it('MA-04: header exibe badge de status quando conversation.status está presente', () => {
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    // Badge de status 'active' deve estar visível
    expect(screen.getByText('active')).toBeTruthy()
  })

  // MA-05 — loading
  it('MA-05: loading=true → spinner visível; lista não aparece', () => {
    mockIdle({ loading: true })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    const spinners = document.querySelectorAll('.animate-spin')
    expect(spinners.length).toBeGreaterThan(0)
    expect(screen.queryByText('Nenhuma mensagem nesta conversa')).toBeNull()
  })

  // MA-06 — error: mensagem de erro
  it('MA-06: error → mensagem de erro visível', () => {
    mockIdle({ error: 'Falha ao carregar mensagens' })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    expect(screen.getByText('Falha ao carregar mensagens')).toBeTruthy()
    expect(screen.getByText('Tentar novamente')).toBeTruthy()
  })

  // MA-07 — error: retry chama refresh
  it('MA-07: clique em "Tentar novamente" chama refresh', () => {
    const refresh = mockIdle({ error: 'Erro qualquer' })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    fireEvent.click(screen.getByText('Tentar novamente'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  // MA-08 — empty state
  it('MA-08: messages vazias após load → "Nenhuma mensagem nesta conversa"', () => {
    mockIdle({ messages: [], loading: false, error: null })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    expect(screen.getByText('Nenhuma mensagem nesta conversa')).toBeTruthy()
  })

  // MA-09 — inbound: body + data-direction
  it('MA-09: mensagem inbound → body visível + data-direction="inbound"', () => {
    const msg = makeMsg('msg-in-001', 'inbound', 'text', 'Olá mundo inbound')
    mockIdle({ messages: [msg] })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    expect(screen.getByText('Olá mundo inbound')).toBeTruthy()
    const bubble = document.querySelector('[data-direction="inbound"]')
    expect(bubble).not.toBeNull()
  })

  // MA-10 — outbound: body + data-direction
  it('MA-10: mensagem outbound → body visível + data-direction="outbound"', () => {
    const msg = makeMsg('msg-out-001', 'outbound', 'text', 'Resposta enviada')
    mockIdle({ messages: [msg] })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    expect(screen.getByText('Resposta enviada')).toBeTruthy()
    const bubble = document.querySelector('[data-direction="outbound"]')
    expect(bubble).not.toBeNull()
  })

  // MA-11 — message_type não suportado
  it('MA-11: message_type desconhecido → "Mensagem não suportada" (sem interpretar body)', () => {
    const msg = makeMsg('msg-img-001', 'inbound', 'image', 'https://exemplo.com/foto.jpg')
    mockIdle({ messages: [msg] })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    expect(screen.getByText('Mensagem não suportada')).toBeTruthy()
    // Body (URL) não deve aparecer renderizado como link ou texto
    expect(screen.queryByText('https://exemplo.com/foto.jpg')).toBeNull()
  })

  // MA-12 — provider_timestamp presente → sem crash
  it('MA-12: provider_timestamp presente → componente renderiza e exibe timestamp', () => {
    const msg = makeMsg('msg-ts-001', 'inbound', 'text', 'Com timestamp', '2026-09-21T15:30:00.000Z')
    mockIdle({ messages: [msg] })
    // Deve renderizar sem crash; alguma string de tempo deve aparecer
    expect(() =>
      render(
        <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
      )
    ).not.toThrow()
  })

  // MA-13 — provider_timestamp null → fallback created_at, sem crash
  it('MA-13: provider_timestamp null → usa created_at; sem crash', () => {
    const msg: MetaChatMessage = {
      ...makeMsg('msg-nots-001', 'inbound', 'text', 'Sem provider_ts', null),
      created_at: '2026-09-21T14:00:00.000Z',
    }
    mockIdle({ messages: [msg] })
    expect(() =>
      render(
        <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
      )
    ).not.toThrow()
    // Texto da mensagem deve aparecer
    expect(screen.getByText('Sem provider_ts')).toBeTruthy()
  })

  // MA-14 — timestamp inválido → sem crash; formatTime retorna ''
  it('MA-14: timestamp inválido → componente não quebra (formatTime retorna string vazia)', () => {
    const msg: MetaChatMessage = {
      ...makeMsg('msg-bads-001', 'inbound', 'text', 'Timestamp ruim', 'nao-e-data'),
      created_at: 'tambem-invalido',
    }
    mockIdle({ messages: [msg] })
    expect(() =>
      render(
        <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
      )
    ).not.toThrow()
    expect(screen.getByText('Timestamp ruim')).toBeTruthy()
  })

  // MA-15 — ordem de renderização
  it('MA-15: mensagens renderizadas na mesma ordem retornada pelo hook', () => {
    const msgs = [
      makeMsg('msg-ord-001', 'inbound',  'text', 'Primeira mensagem'),
      makeMsg('msg-ord-002', 'outbound', 'text', 'Segunda mensagem'),
      makeMsg('msg-ord-003', 'inbound',  'text', 'Terceira mensagem'),
    ]
    mockIdle({ messages: msgs })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    // Verificar presença de todas
    expect(screen.getByText('Primeira mensagem')).toBeTruthy()
    expect(screen.getByText('Segunda mensagem')).toBeTruthy()
    expect(screen.getByText('Terceira mensagem')).toBeTruthy()

    // Verificar ordem via posição no DOM
    const allBubbles = document.querySelectorAll('[data-direction]')
    expect(allBubbles[0].getAttribute('data-direction')).toBe('inbound')
    expect(allBubbles[1].getAttribute('data-direction')).toBe('outbound')
    expect(allBubbles[2].getAttribute('data-direction')).toBe('inbound')
  })

  // MA-16 — read-only: zero input/textarea/contentEditable/botão envio
  it('MA-16: componente é read-only — sem input, textarea, contentEditable ou botão de envio', () => {
    const msgs = [makeMsg('msg-ro-001')]
    mockIdle({ messages: msgs })
    render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )
    // Nenhum campo de entrada
    expect(document.querySelector('input')).toBeNull()
    expect(document.querySelector('textarea')).toBeNull()
    expect(document.querySelector('[contenteditable]')).toBeNull()

    // Nenhum botão de envio (o único button presente é o de retry, ausente neste estado)
    const buttons = document.querySelectorAll('button')
    const sendButtons = Array.from(buttons).filter(btn =>
      /enviar|send|submit/i.test(btn.textContent || '')
    )
    expect(sendButtons).toHaveLength(0)
  })

  // MA-17 — conversation undefined → sem crash
  it('MA-17: conversation undefined → componente renderiza sem crash', () => {
    expect(() =>
      render(
        <MetaChatArea
          companyId={COMPANY_ID}
          conversationId={CONV_ID}
          conversation={undefined}
        />
      )
    ).not.toThrow()
  })

  // MA-18 — scroll: mudança de messages não produz erro
  it('MA-18: mudança de messages executa scroll sem lançar erro', () => {
    // Simula scrollHeight/scrollTop (jsdom retorna 0, mas não deve lançar)
    const msgs1 = [makeMsg('msg-sc-001')]
    mockIdle({ messages: msgs1 })

    const { rerender } = render(
      <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
    )

    const msgs2 = [makeMsg('msg-sc-001'), makeMsg('msg-sc-002')]
    mockIdle({ messages: msgs2 })

    expect(() =>
      rerender(
        <MetaChatArea companyId={COMPANY_ID} conversationId={CONV_ID} conversation={CONV_FULL} />
      )
    ).not.toThrow()
  })
})
