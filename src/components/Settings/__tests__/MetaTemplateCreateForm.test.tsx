// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MetaTemplateCreateForm } from '../MetaTemplateCreateForm'
import { metaWhatsAppApi } from '../../../services/metaWhatsAppApi'

vi.mock('../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: { createTemplate: vi.fn() },
}))

const mockCreate = metaWhatsAppApi.createTemplate as ReturnType<typeof vi.fn>

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({
    id: '594425479261596',
    name: 'pedido_enviado',
    language: 'pt_BR',
    status: 'PENDING',
    category: 'UTILITY',
  })
})

function fillRequired() {
  fireEvent.change(screen.getByPlaceholderText('pedido_enviado'), { target: { value: 'pedido_enviado' } })
  fireEvent.change(screen.getByLabelText('Mensagem', { exact: true }), {
    target: { value: 'Olá {{1}}, pedido {{2}} enviado.' },
  })
}

describe('MetaTemplateCreateForm', () => {
  it('MTC-01: abre com prévia e fecha sem enviar', () => {
    const onCancel = vi.fn()
    render(
      <MetaTemplateCreateForm
        companyId="company-1"
        instanceId="inst-1"
        onCancel={onCancel}
        onCreated={vi.fn()}
      />,
    )
    expect(screen.getByText('Criar modelo Meta')).toBeTruthy()
    expect(screen.getByText('Prévia da mensagem')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /voltar à lista/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('MTC-02: validação local impede envio sem body', () => {
    render(
      <MetaTemplateCreateForm
        companyId="company-1"
        instanceId="inst-1"
        onCancel={vi.fn()}
        onCreated={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText('pedido_enviado'), { target: { value: 'pedido_enviado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação da Meta' }))
    expect(mockCreate).not.toHaveBeenCalled()
    expect(screen.getByText(/texto da mensagem é obrigatório/i)).toBeTruthy()
  })

  it('MTC-03: prévia preserva texto integral e variáveis', () => {
    render(
      <MetaTemplateCreateForm
        companyId="company-1"
        instanceId="inst-1"
        onCancel={vi.fn()}
        onCreated={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText('Cabeçalho (opcional)'), { target: { value: 'Olá {{1}} 😀' } })
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Linha 1\nLinha 2 {{pedido}}' } })
    fireEvent.change(screen.getByLabelText('Rodapé (opcional)'), { target: { value: 'Lovoo' } })
    expect(screen.getAllByText('Olá {{1}} 😀').length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('Linha 2 {{pedido}}')
    expect(screen.getAllByText('Lovoo').length).toBeGreaterThan(0)
  })

  it('MTC-04: exemplos das variáveis e sucesso não afirma aprovação', async () => {
    const onCreated = vi.fn()
    render(
      <MetaTemplateCreateForm
        companyId="company-1"
        instanceId="inst-1"
        onCancel={vi.fn()}
        onCreated={onCreated}
      />,
    )
    fillRequired()
    await waitFor(() => expect(screen.getByLabelText('Mensagem · {{1}}')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Mensagem · {{1}}'), { target: { value: 'João' } })
    fireEvent.change(screen.getByLabelText('Mensagem · {{2}}'), { target: { value: 'ORD-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação da Meta' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      companyId: 'company-1',
      instanceId: 'inst-1',
      name: 'pedido_enviado',
      body_text: 'Olá {{1}}, pedido {{2}} enviado.',
      examples: { body: { '1': 'João', '2': 'ORD-1' } },
    })
    expect(mockCreate.mock.calls[0][0].waba_id).toBeUndefined()
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING' }))
  })

  it('MTC-05: loading e duplo clique enviam uma vez; erro preserva o formulário', async () => {
    let resolveCreate: (value: unknown) => void = () => {}
    mockCreate.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve }))
    render(
      <MetaTemplateCreateForm
        companyId="company-1"
        instanceId="inst-1"
        onCancel={vi.fn()}
        onCreated={vi.fn()}
      />,
    )
    fillRequired()
    await waitFor(() => expect(screen.getByLabelText('Mensagem · {{1}}')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Mensagem · {{1}}'), { target: { value: 'João' } })
    fireEvent.change(screen.getByLabelText('Mensagem · {{2}}'), { target: { value: 'ORD-1' } })
    const submit = screen.getByRole('button', { name: 'Enviar para aprovação da Meta' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    mockCreate.mockRejectedValueOnce(new Error('provider_error'))
    resolveCreate(Promise.reject(new Error('provider_error')))
    await waitFor(() => expect(screen.getByText(/A Meta recusou este modelo/)).toBeTruthy())
    expect((screen.getByPlaceholderText('pedido_enviado') as HTMLInputElement).value).toBe('pedido_enviado')
  })

  it('MTC-07: timeout pede atualizar a lista e não afirma rejeição', async () => {
    mockCreate.mockReset()
    mockCreate.mockRejectedValue(new Error('provider_unavailable'))
    render(
      <MetaTemplateCreateForm
        companyId="company-1"
        instanceId="inst-1"
        onCancel={vi.fn()}
        onCreated={vi.fn()}
      />,
    )
    expect(screen.getByText('A Meta pode reclassificar a categoria na análise.')).toBeTruthy()
    fillRequired()
    await waitFor(() => expect(screen.getByLabelText('Mensagem · {{1}}')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Mensagem · {{1}}'), { target: { value: 'João' } })
    fireEvent.change(screen.getByLabelText('Mensagem · {{2}}'), { target: { value: 'ORD-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação da Meta' }))
    await waitFor(() => expect(screen.getByText(/Atualize a lista antes de tentar novamente/)).toBeTruthy())
    expect(document.body.textContent).not.toMatch(/recusou/i)
    expect((screen.getByPlaceholderText('pedido_enviado') as HTMLInputElement).value).toBe('pedido_enviado')
  })

  it('MTC-06: sem instanceId o envio fica bloqueado', () => {
    render(
      <MetaTemplateCreateForm
        companyId="company-1"
        instanceId=""
        onCancel={vi.fn()}
        onCreated={vi.fn()}
      />,
    )
    expect((screen.getByRole('button', { name: 'Enviar para aprovação da Meta' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
