// @vitest-environment jsdom
// =============================================================================
// MetaTemplatePicker.test.tsx — MVP4A
//
// Testa o picker de templates em isolamento.
// NÃO repete cobertura de contrato de listTemplates (já em metaWhatsAppApiConversations.test.ts).
//
// Cobertura:
// TP-01  fechado não carrega listTemplates
// TP-02  abrir dispara listTemplates
// TP-03  companyId correto na chamada
// TP-04  instanceId correto na chamada
// TP-05  paginação até next_cursor null (2 páginas)
// TP-06  cap de 3 páginas — para mesmo com next_cursor presente
// TP-07  truncated após terceira página — aviso exibido
// TP-08  stale response após close ignorada (cancelled flag)
// TP-09  stale response após reopen ignorada (generation ref)
// TP-10  supported=false não aparece na lista
// TP-11  name aparece; language aparece; category aparece
// TP-12  seleção cria input de parâmetro BODY
// TP-13  HEADER e BODY geram inputs separados
// TP-14  POSITIONAL — placeholder usa key numérica (ex: '1')
// TP-15  NAMED — placeholder usa key nomeada (ex: 'name')
// TP-16  example usado como placeholder, NÃO como valor pré-preenchido
// TP-17  template sem parâmetros — botão Enviar habilitado após selecionar
// TP-18  whitespace no campo desabilita botão Enviar
// TP-19  preview BODY reflete valor digitado
// TP-20  preview HEADER reflete valor digitado (namespace independente)
// TP-21  footer estático exibido sem input
// TP-22  namespace HEADER/BODY independentes — valor BODY não altera HEADER
// TP-23  Cancelar chama onClose
// TP-24  sending=true desabilita botão Enviar
// TP-25  erro de listagem exibe mensagem e botão de retry
// TP-26  retry reinicia carregamento
// TP-27  onSend recebe template.name, template.language e parameterValues
// TP-28  onSend NÃO recebe to/wa_id/recipient
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { MetaTemplatePicker }   from '../MetaTemplatePicker'
import type {
  MetaWhatsAppTemplate,
  MetaTemplateParameterValues,
  GetMetaTemplatesResponse,
} from '../../../../types/meta-whatsapp'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: { listTemplates: vi.fn() },
}))

import { metaWhatsAppApi } from '../../../../services/metaWhatsAppApi'
const mockListTemplates = metaWhatsAppApi.listTemplates as ReturnType<typeof vi.fn>

beforeEach(() => { vi.clearAllMocks() })
afterEach(() => { cleanup() })

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COMPANY  = 'co-001'
const INSTANCE = 'inst-001'

const TMPL_POSITIONAL: MetaWhatsAppTemplate = {
  id:                 'tpl-pos-001',
  name:               'hello_world',
  language:           'pt_BR',
  status:             'APPROVED',
  category:           'UTILITY',
  parameter_format:   'POSITIONAL',
  components:         [{ type: 'BODY', text: 'Olá, {{1}}! Seu código é {{2}}.' }],
  parameters:         [
    { component: 'BODY', key: '1', position: 1, example: 'João' },
    { component: 'BODY', key: '2', position: 2, example: '12345' },
  ],
  supported:          true,
  unsupported_reason: null,
}

const TMPL_NAMED: MetaWhatsAppTemplate = {
  id:                 'tpl-named-002',
  name:               'order_confirmation',
  language:           'pt_BR',
  status:             'APPROVED',
  category:           'MARKETING',
  parameter_format:   'NAMED',
  components:         [
    { type: 'HEADER', text: 'Pedido {{order_id}}' },
    { type: 'BODY',   text: 'Olá, {{name}}! Seu pedido foi confirmado.' },
    { type: 'FOOTER', text: 'Equipe de suporte' },
  ],
  parameters:         [
    { component: 'HEADER', key: 'order_id', position: null, example: 'ORD-999' },
    { component: 'BODY',   key: 'name',     position: null, example: 'Maria' },
  ],
  supported:          true,
  unsupported_reason: null,
}

const TMPL_NO_PARAMS: MetaWhatsAppTemplate = {
  id:                 'tpl-noparam-003',
  name:               'simple_template',
  language:           'en_US',
  status:             'APPROVED',
  category:           'UTILITY',
  parameter_format:   'NAMED',
  components:         [{ type: 'BODY', text: 'Olá! Bem-vindo.' }],
  parameters:         [],
  supported:          true,
  unsupported_reason: null,
}

const TMPL_UNSUPPORTED: MetaWhatsAppTemplate = {
  id:                 'tpl-unsup-004',
  name:               'promo_image',
  language:           'pt_BR',
  status:             'APPROVED',
  category:           'MARKETING',
  parameter_format:   'NAMED',
  components:         [{ type: 'HEADER', format: 'IMAGE' }],
  parameters:         [],
  supported:          false,
  unsupported_reason: 'header_media_not_supported',
}

function makeListResp(
  templates: MetaWhatsAppTemplate[],
  next_cursor: string | null = null,
): GetMetaTemplatesResponse {
  return { templates, next_cursor }
}

// Props padrão para o picker
const defaultOnClose = vi.fn()
const defaultOnSend  = vi.fn().mockResolvedValue(undefined)

function renderPicker(props: Partial<{
  open:     boolean
  sending:  boolean
  onClose:  () => void
  onSend:   (t: MetaWhatsAppTemplate, p: MetaTemplateParameterValues) => Promise<void>
}> = {}) {
  return render(
    <MetaTemplatePicker
      companyId={COMPANY}
      instanceId={INSTANCE}
      open={props.open ?? true}
      sending={props.sending ?? false}
      onClose={props.onClose ?? defaultOnClose}
      onSend={props.onSend ?? defaultOnSend}
    />
  )
}

// =============================================================================
// TP-01  fechado não carrega
// =============================================================================

describe('MetaTemplatePicker — carregamento', () => {
  it('TP-01: open=false → NÃO chama listTemplates', () => {
    renderPicker({ open: false })
    expect(mockListTemplates).not.toHaveBeenCalled()
  })

  it('TP-02: open=true → chama listTemplates', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL]))
    renderPicker({ open: true })
    await waitFor(() => expect(mockListTemplates).toHaveBeenCalledTimes(1))
  })

  it('TP-03: chama listTemplates com companyId correto', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([]))
    renderPicker()
    await waitFor(() => expect(mockListTemplates).toHaveBeenCalled())
    expect(mockListTemplates.mock.calls[0][0]).toBe(COMPANY)
  })

  it('TP-04: chama listTemplates com instanceId correto', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([]))
    renderPicker()
    await waitFor(() => expect(mockListTemplates).toHaveBeenCalled())
    expect(mockListTemplates.mock.calls[0][1]).toBe(INSTANCE)
  })

  // TP-05 — paginação até next_cursor null (2 páginas)
  it('TP-05: paginação — segue next_cursor até null (2 páginas)', async () => {
    mockListTemplates
      .mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL], 'cursor-page-2'))
      .mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS], null))
    renderPicker()
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    expect(screen.getByText('simple_template')).toBeTruthy()
    expect(mockListTemplates).toHaveBeenCalledTimes(2)
    expect(mockListTemplates.mock.calls[1][2]).toEqual({ after: 'cursor-page-2' })
  })

  // TP-06 — cap de 3 páginas
  it('TP-06: cap de 3 páginas — para mesmo com next_cursor presente', async () => {
    mockListTemplates
      .mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL], 'cursor-2'))
      .mockResolvedValueOnce(makeListResp([TMPL_NAMED],     'cursor-3'))
      .mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS], 'cursor-4')) // 3ª → still has cursor
    renderPicker()
    await waitFor(() => expect(mockListTemplates).toHaveBeenCalledTimes(3))
    // 4ª página NÃO deve ser chamada
    expect(mockListTemplates).toHaveBeenCalledTimes(3)
  })

  // TP-07 — truncated aviso
  it('TP-07: truncated após terceira página com cursor remanescente → aviso exibido', async () => {
    mockListTemplates
      .mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL], 'c2'))
      .mockResolvedValueOnce(makeListResp([TMPL_NAMED],      'c3'))
      .mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS],  'c4'))
    renderPicker()
    await waitFor(() => expect(screen.getByText(/Alguns templates não foram carregados/)).toBeTruthy())
  })

  // TP-08 — stale após close
  it('TP-08: stale response após close → não atualiza state', async () => {
    let resolve!: (v: GetMetaTemplatesResponse) => void
    mockListTemplates.mockImplementation(() => new Promise(r => { resolve = r }))

    const { rerender } = renderPicker({ open: true })
    expect(mockListTemplates).toHaveBeenCalledTimes(1)

    // Fechar picker (muda prop open=false)
    rerender(
      <MetaTemplatePicker
        companyId={COMPANY} instanceId={INSTANCE}
        open={false} sending={false}
        onClose={defaultOnClose} onSend={defaultOnSend}
      />
    )

    // Resolver a promise stale
    await act(async () => { resolve(makeListResp([TMPL_POSITIONAL])) })

    // Picker fechado — não deve mostrar templates da response stale
    expect(screen.queryByText('hello_world')).toBeNull()
  })

  // TP-09 — stale após reopen
  it('TP-09: stale response da abertura anterior → ignorada após reopen', async () => {
    let resolveFirst!: (v: GetMetaTemplatesResponse) => void
    mockListTemplates
      .mockImplementationOnce(() => new Promise(r => { resolveFirst = r }))
      .mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS]))

    const { rerender } = renderPicker({ open: true })

    // Fechar e reabrir
    rerender(
      <MetaTemplatePicker companyId={COMPANY} instanceId={INSTANCE}
        open={false} sending={false} onClose={defaultOnClose} onSend={defaultOnSend} />
    )
    rerender(
      <MetaTemplatePicker companyId={COMPANY} instanceId={INSTANCE}
        open={true} sending={false} onClose={defaultOnClose} onSend={defaultOnSend} />
    )

    // 2ª load resolve com simple_template
    await waitFor(() => expect(screen.getByText('simple_template')).toBeTruthy())

    // Resolver 1ª load stale com hello_world
    await act(async () => { resolveFirst(makeListResp([TMPL_POSITIONAL])) })

    // hello_world NÃO deve aparecer (stale)
    expect(screen.queryByText('hello_world')).toBeNull()
  })
})

// =============================================================================
// Filtro, listagem e identidade
// =============================================================================

describe('MetaTemplatePicker — filtro e listagem', () => {
  beforeEach(async () => {
    mockListTemplates.mockResolvedValueOnce(
      makeListResp([TMPL_POSITIONAL, TMPL_UNSUPPORTED, TMPL_NO_PARAMS])
    )
    renderPicker()
    await waitFor(() => screen.getByText('hello_world'))
  })

  it('TP-10: supported=false NÃO aparece na lista', () => {
    expect(screen.queryByText('promo_image')).toBeNull()
  })

  it('TP-11: name, language e category aparecem para template suportado', () => {
    expect(screen.getByText('hello_world')).toBeTruthy()
    // language e category aparecem juntos
    expect(screen.getByText('pt_BR · UTILITY')).toBeTruthy()
  })
})

// =============================================================================
// Seleção e parâmetros
// =============================================================================

describe('MetaTemplatePicker — seleção e parâmetros', () => {
  it('TP-12: seleção de template BODY cria input de parâmetro', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL]))
    renderPicker()
    await waitFor(() => screen.getByText('hello_world'))
    fireEvent.click(screen.getByText('hello_world'))
    expect(screen.getByLabelText('Parâmetro BODY 1')).toBeTruthy()
    expect(screen.getByLabelText('Parâmetro BODY 2')).toBeTruthy()
  })

  it('TP-13: template com HEADER e BODY gera inputs separados', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NAMED]))
    renderPicker()
    await waitFor(() => screen.getByText('order_confirmation'))
    fireEvent.click(screen.getByText('order_confirmation'))
    expect(screen.getByLabelText('Parâmetro HEADER order_id')).toBeTruthy()
    expect(screen.getByLabelText('Parâmetro BODY name')).toBeTruthy()
  })

  it('TP-14: POSITIONAL — placeholder usa key numérica como fallback', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL]))
    renderPicker()
    await waitFor(() => screen.getByText('hello_world'))
    fireEvent.click(screen.getByText('hello_world'))
    // example 'João' e '12345' usados como placeholder
    const input1 = screen.getByLabelText('Parâmetro BODY 1') as HTMLInputElement
    expect(input1.placeholder).toBe('João')
  })

  it('TP-15: NAMED — placeholder usa key nomeada', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NAMED]))
    renderPicker()
    await waitFor(() => screen.getByText('order_confirmation'))
    fireEvent.click(screen.getByText('order_confirmation'))
    const inputName = screen.getByLabelText('Parâmetro BODY name') as HTMLInputElement
    expect(inputName.placeholder).toBe('Maria')
  })

  it('TP-16: example usado como placeholder — NÃO como valor pré-preenchido', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL]))
    renderPicker()
    await waitFor(() => screen.getByText('hello_world'))
    fireEvent.click(screen.getByText('hello_world'))
    const input = screen.getByLabelText('Parâmetro BODY 1') as HTMLInputElement
    // Valor (value) deve ser vazio — não pré-preenchido com example
    expect(input.value).toBe('')
    // Placeholder sim
    expect(input.placeholder).toBe('João')
  })

  it('TP-17: template sem parâmetros → botão Enviar habilitado após seleção', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS]))
    renderPicker()
    await waitFor(() => screen.getByText('simple_template'))
    fireEvent.click(screen.getByText('simple_template'))
    const btn = screen.getByRole('button', { name: /enviar template/i })
    expect(btn).toHaveProperty('disabled', false)
  })

  it('TP-18: campo com somente whitespace → botão Enviar desabilitado', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL]))
    renderPicker()
    await waitFor(() => screen.getByText('hello_world'))
    fireEvent.click(screen.getByText('hello_world'))
    const input1 = screen.getByLabelText('Parâmetro BODY 1')
    const input2 = screen.getByLabelText('Parâmetro BODY 2')
    fireEvent.change(input1, { target: { value: '   ' } })
    fireEvent.change(input2, { target: { value: 'valor' } })
    expect(screen.getByRole('button', { name: /enviar template/i })).toHaveProperty('disabled', true)
  })
})

// =============================================================================
// Preview
// =============================================================================

describe('MetaTemplatePicker — preview', () => {
  it('TP-19: preview BODY reflete valor digitado', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL]))
    renderPicker()
    await waitFor(() => screen.getByText('hello_world'))
    fireEvent.click(screen.getByText('hello_world'))
    fireEvent.change(screen.getByLabelText('Parâmetro BODY 1'), { target: { value: 'Carlos' } })
    fireEvent.change(screen.getByLabelText('Parâmetro BODY 2'), { target: { value: '99999' } })
    await waitFor(() => {
      const preview = screen.getByTestId('preview-body')
      expect(preview.textContent).toContain('Carlos')
      expect(preview.textContent).toContain('99999')
    })
  })

  it('TP-20: preview HEADER reflete valor digitado (namespace independente do BODY)', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NAMED]))
    renderPicker()
    await waitFor(() => screen.getByText('order_confirmation'))
    fireEvent.click(screen.getByText('order_confirmation'))
    fireEvent.change(screen.getByLabelText('Parâmetro HEADER order_id'), { target: { value: 'ORD-001' } })
    await waitFor(() => {
      const header = screen.getByTestId('preview-header')
      expect(header.textContent).toContain('ORD-001')
    })
  })

  it('TP-21: footer estático exibido sem input', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NAMED]))
    renderPicker()
    await waitFor(() => screen.getByText('order_confirmation'))
    fireEvent.click(screen.getByText('order_confirmation'))
    await waitFor(() => {
      const footer = screen.getByTestId('preview-footer')
      expect(footer.textContent).toBe('Equipe de suporte')
    })
    // Nenhum input de footer
    expect(screen.queryByLabelText(/Parâmetro FOOTER/i)).toBeNull()
  })

  it('TP-22: HEADER e BODY têm namespaces independentes — valor BODY não afeta preview HEADER', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NAMED]))
    renderPicker()
    await waitFor(() => screen.getByText('order_confirmation'))
    fireEvent.click(screen.getByText('order_confirmation'))
    // Preencher HEADER
    fireEvent.change(screen.getByLabelText('Parâmetro HEADER order_id'), { target: { value: 'ORD-XYZ' } })
    // Preencher BODY
    fireEvent.change(screen.getByLabelText('Parâmetro BODY name'), { target: { value: 'Ana' } })
    await waitFor(() => {
      // Preview HEADER usa somente o namespace HEADER
      expect(screen.getByTestId('preview-header').textContent).toContain('ORD-XYZ')
      expect(screen.getByTestId('preview-header').textContent).not.toContain('Ana')
      // Preview BODY usa somente o namespace BODY
      expect(screen.getByTestId('preview-body').textContent).toContain('Ana')
      expect(screen.getByTestId('preview-body').textContent).not.toContain('ORD-XYZ')
    })
  })
})

// =============================================================================
// Ações e envio
// =============================================================================

describe('MetaTemplatePicker — ações', () => {
  it('TP-23: Cancelar chama onClose', async () => {
    const onClose = vi.fn()
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_POSITIONAL]))
    render(
      <MetaTemplatePicker companyId={COMPANY} instanceId={INSTANCE}
        open={true} sending={false} onClose={onClose} onSend={defaultOnSend} />
    )
    await waitFor(() => screen.getByText('hello_world'))
    fireEvent.click(screen.getByText('Cancelar'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('TP-24: sending=true → botão Enviar desabilitado mesmo com template e params completos', async () => {
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS]))
    renderPicker({ sending: true })
    await waitFor(() => screen.getByText('simple_template'))
    fireEvent.click(screen.getByText('simple_template'))
    expect(screen.getByRole('button', { name: /enviar template/i })).toHaveProperty('disabled', true)
  })

  it('TP-25: erro de listagem → mensagem de erro visível + botão Tentar novamente', async () => {
    mockListTemplates.mockRejectedValueOnce(new Error('network_error'))
    renderPicker()
    await waitFor(() => screen.getByText(/Tentar novamente/i))
    expect(screen.queryByText('hello_world')).toBeNull()
  })

  it('TP-26: clicar Tentar novamente reinicia carregamento', async () => {
    mockListTemplates
      .mockRejectedValueOnce(new Error('network_error'))
      .mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS]))
    renderPicker()
    await waitFor(() => screen.getByText(/Tentar novamente/i))
    fireEvent.click(screen.getByText('Tentar novamente'))
    await waitFor(() => screen.getByText('simple_template'))
    expect(mockListTemplates).toHaveBeenCalledTimes(2)
  })

  it('TP-27: onSend recebe template completo e parameterValues corretos', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS]))
    render(
      <MetaTemplatePicker companyId={COMPANY} instanceId={INSTANCE}
        open={true} sending={false} onClose={defaultOnClose} onSend={onSend} />
    )
    await waitFor(() => screen.getByText('simple_template'))
    fireEvent.click(screen.getByText('simple_template'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar template/i }))
    })
    expect(onSend).toHaveBeenCalledTimes(1)
    const [tmpl, params] = onSend.mock.calls[0] as [MetaWhatsAppTemplate, MetaTemplateParameterValues]
    expect(tmpl.name).toBe('simple_template')
    expect(tmpl.language).toBe('en_US')
    expect(params).toEqual({ body: {} })
  })

  it('TP-28: onSend NÃO recebe to, wa_id, recipient ou qualquer campo proibido', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined)
    mockListTemplates.mockResolvedValueOnce(makeListResp([TMPL_NO_PARAMS]))
    render(
      <MetaTemplatePicker companyId={COMPANY} instanceId={INSTANCE}
        open={true} sending={false} onClose={defaultOnClose} onSend={onSend} />
    )
    await waitFor(() => screen.getByText('simple_template'))
    fireEvent.click(screen.getByText('simple_template'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /enviar template/i }))
    })
    const [tmpl, params] = onSend.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(tmpl).not.toHaveProperty('to')
    expect(tmpl).not.toHaveProperty('wa_id')
    expect(tmpl).not.toHaveProperty('recipient')
    expect(params).not.toHaveProperty('to')
    expect(params).not.toHaveProperty('wa_id')
  })
})
