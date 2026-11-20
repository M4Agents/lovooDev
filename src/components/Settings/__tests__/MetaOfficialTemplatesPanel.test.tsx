// @vitest-environment jsdom
// =============================================================================
// MetaOfficialTemplatesPanel — Fase A
// Listagem administrativa. Sem create/edit/delete/send.
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MetaOfficialTemplatesPanel } from '../MetaOfficialTemplatesPanel'
import type { MetaAdminWhatsAppTemplate, MetaWhatsAppInstance } from '../../../types/meta-whatsapp'

vi.mock('../../../hooks/useCompany', () => ({ useCompany: vi.fn() }))
vi.mock('../../../hooks/useMetaWhatsAppInstances', () => ({
  useMetaWhatsAppInstances: vi.fn(),
}))
vi.mock('../../../hooks/useAccessControl', () => ({
  useAccessControl: vi.fn(() => ({ canConnectMetaWhatsApp: true })),
}))
vi.mock('../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: { listAdminTemplates: vi.fn(), createTemplate: vi.fn() },
}))

import { useAccessControl } from '../../../hooks/useAccessControl'
import { useCompany } from '../../../hooks/useCompany'
import { useMetaWhatsAppInstances } from '../../../hooks/useMetaWhatsAppInstances'
import { metaWhatsAppApi } from '../../../services/metaWhatsAppApi'

const COMPANY = { id: 'company-meta-tpl-001' }

const FAKE_INSTANCE: MetaWhatsAppInstance = {
  id:              'inst-meta-001',
  phone_number_id: '112233445566',
  waba_id:         '998877665544',
  display_name:    'Loja Centro',
  phone_number:    '+55 11 98765-4321',
  verified_name:   'Loja Centro Verified',
  status:          'connected',
  created_at:      '2026-01-01T00:00:00.000Z',
  updated_at:      '2026-01-01T00:00:00.000Z',
}

const FAKE_INSTANCE_B: MetaWhatsAppInstance = {
  ...FAKE_INSTANCE,
  id:            'inst-meta-002',
  display_name:  'Loja Sul',
  verified_name: 'Loja Sul Verified',
  waba_id:       '111122223333',
}

const FAKE_ADMIN_TEMPLATE: MetaAdminWhatsAppTemplate = {
  id:                  'tpl-admin-1',
  name:                'hello_world',
  language:            'pt_BR',
  status:              'PENDING',
  category:            'MARKETING',
  parameter_format:    'POSITIONAL',
  components:          [{ type: 'BODY', text: 'Olá' }],
  parameters:          [],
  supported:           true,
  unsupported_reason:  null,
  header_media_format: null,
  buttons:             [],
}

const mockListAdmin = metaWhatsAppApi.listAdminTemplates as ReturnType<typeof vi.fn>
const mockCreateTemplate = metaWhatsAppApi.createTemplate as ReturnType<typeof vi.fn>
let mockRefresh: ReturnType<typeof vi.fn>

afterEach(cleanup)

beforeEach(() => {
  vi.clearAllMocks()
  mockRefresh = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useAccessControl).mockReturnValue({ canConnectMetaWhatsApp: true } as any)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useCompany).mockReturnValue({ company: COMPANY } as any)
  vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
    instances: [FAKE_INSTANCE],
    loading:   false,
    error:     null,
    refresh:   mockRefresh as unknown as () => void,
  })
  mockListAdmin.mockResolvedValue({
    templates:   [FAKE_ADMIN_TEMPLATE],
    next_cursor: null,
  })
})

describe('MetaOfficialTemplatesPanel', () => {
  it('MOT-01: sem integração conectada → estado vazio, sem chamada Graph', async () => {
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      instances: [{ ...FAKE_INSTANCE, status: 'disconnected' }],
      loading:   false,
      error:     null,
      refresh:   mockRefresh as unknown as () => void,
    })
    render(<MetaOfficialTemplatesPanel />)
    expect(screen.getByText('Nenhuma conta Meta conectada')).toBeTruthy()
    expect(mockListAdmin).not.toHaveBeenCalled()
  })

  it('MOT-02: erro de instâncias → retry chama refresh', () => {
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      instances: [],
      loading:   false,
      error:     'Acesso negado',
      refresh:   mockRefresh as unknown as () => void,
    })
    render(<MetaOfficialTemplatesPanel />)
    expect(screen.getByText('Acesso negado')).toBeTruthy()
    fireEvent.click(screen.getByText('Tentar novamente'))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('MOT-03: lista templates com status=ALL e sem expor waba/token', async () => {
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(mockListAdmin).toHaveBeenCalledTimes(1))
    expect(mockListAdmin).toHaveBeenCalledWith(COMPANY.id, FAKE_INSTANCE.id, { status: 'ALL' })
    expect(screen.getByText('hello_world')).toBeTruthy()
    expect(screen.getByText('PENDING')).toBeTruthy()
    expect(screen.getByText('pt_BR')).toBeTruthy()
    expect(screen.getByText('MARKETING')).toBeTruthy()
    const html = document.body.textContent ?? ''
    expect(html).not.toContain(FAKE_INSTANCE.waba_id)
    expect(html).not.toContain(FAKE_INSTANCE.phone_number_id)
    expect(html).not.toContain('EAA')
  })

  it('MOT-04: mais de uma instância → seletor visível', async () => {
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      instances: [FAKE_INSTANCE, FAKE_INSTANCE_B],
      loading:   false,
      error:     null,
      refresh:   mockRefresh as unknown as () => void,
    })
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('Conta Meta')).toBeTruthy())
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(FAKE_INSTANCE.id)
  })

  it('MOT-05: Carregar mais envia after do cursor', async () => {
    mockListAdmin
      .mockResolvedValueOnce({ templates: [FAKE_ADMIN_TEMPLATE], next_cursor: 'cursor-p2' })
      .mockResolvedValueOnce({
        templates: [{ ...FAKE_ADMIN_TEMPLATE, id: 'tpl-admin-2', name: 'promo_rejected', status: 'REJECTED' }],
        next_cursor: null,
      })
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    fireEvent.click(screen.getByText('Carregar mais'))
    await waitFor(() => expect(mockListAdmin).toHaveBeenCalledTimes(2))
    expect(mockListAdmin.mock.calls[1][2]).toEqual({ status: 'ALL', after: 'cursor-p2' })
    expect(screen.getByText('promo_rejected')).toBeTruthy()
  })

  it('MOT-07: clique na linha abre detalhes integrais e fechar volta à lista', async () => {
    mockListAdmin.mockResolvedValue({
      templates: [{
        ...FAKE_ADMIN_TEMPLATE,
        components: [{ type: 'BODY', text: 'Corpo completo do modelo' }],
      }],
      next_cursor: null,
    })
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhes de hello_world' }))
    expect(screen.getByText('Prévia da mensagem')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver detalhes técnicos' })).toBeTruthy()
    expect(screen.queryByText('Detalhes técnicos')).toBeNull()
    expect(screen.getAllByText('Corpo completo do modelo').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: /voltar à lista/i }))
    expect(screen.getByRole('button', { name: 'Abrir detalhes de hello_world' })).toBeTruthy()
  })

  it('MOT-08: trocar instância fecha detalhes anteriores', async () => {
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      instances: [FAKE_INSTANCE, FAKE_INSTANCE_B],
      loading:   false,
      error:     null,
      refresh:   mockRefresh as unknown as () => void,
    })
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Abrir detalhes de hello_world' }))
    expect(screen.getByText('Prévia da mensagem')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: FAKE_INSTANCE_B.id } })
    await waitFor(() => expect(screen.queryByText('Prévia da mensagem')).toBeNull())
  })

  it('MOT-06: erro da listagem → retry dispara nova consulta', async () => {
    mockListAdmin
      .mockRejectedValueOnce(new Error('provider_unavailable'))
      .mockResolvedValueOnce({ templates: [FAKE_ADMIN_TEMPLATE], next_cursor: null })
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('provider_unavailable')).toBeTruthy())
    fireEvent.click(screen.getByText('Tentar novamente'))
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    expect(mockListAdmin).toHaveBeenCalledTimes(2)
  })

  it('MOT-09: Criar modelo abre o formulário e cancelar volta à lista', async () => {
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }))
    expect(screen.getByText('Criar modelo Meta')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Abrir detalhes de hello_world' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /voltar à lista/i }))
    expect(screen.getByRole('button', { name: 'Abrir detalhes de hello_world' })).toBeTruthy()
  })

  it('MOT-10: seller não vê criação', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAccessControl).mockReturnValue({ canConnectMetaWhatsApp: false } as any)
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    expect(screen.queryByRole('button', { name: 'Criar modelo' })).toBeNull()
  })

  it('MOT-11: sucesso atualiza a listagem e não afirma aprovação', async () => {
    mockCreateTemplate.mockResolvedValue({
      id: '594425479261596',
      name: 'pedido_enviado',
      language: 'pt_BR',
      status: 'PENDING',
      category: 'UTILITY',
    })
    mockListAdmin
      .mockResolvedValueOnce({ templates: [FAKE_ADMIN_TEMPLATE], next_cursor: null })
      .mockResolvedValueOnce({
        templates: [
          FAKE_ADMIN_TEMPLATE,
          { ...FAKE_ADMIN_TEMPLATE, id: 'tpl-new', name: 'pedido_enviado', status: 'PENDING' },
        ],
        next_cursor: null,
      })
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }))
    fireEvent.change(screen.getByPlaceholderText('pedido_enviado'), { target: { value: 'pedido_enviado' } })
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Olá cliente' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação da Meta' }))
    await waitFor(() => expect(mockCreateTemplate).toHaveBeenCalledTimes(1))
    expect(mockCreateTemplate.mock.calls[0][0].instanceId).toBe(FAKE_INSTANCE.id)
    await waitFor(() => expect(screen.getByText(/enviado para análise da Meta/)).toBeTruthy())
    expect(screen.getByText(/Status atual: PENDING/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/aprovado imediatamente/i)
    await waitFor(() => expect(mockListAdmin).toHaveBeenCalledTimes(2))
  })

  it('MOT-12: instância é travada ao abrir o formulário', async () => {
    mockCreateTemplate.mockResolvedValue({
      id: '594425479261596',
      name: 'pedido_enviado',
      language: 'pt_BR',
      status: 'PENDING',
      category: 'UTILITY',
    })
    vi.mocked(useMetaWhatsAppInstances).mockReturnValue({
      instances: [FAKE_INSTANCE, FAKE_INSTANCE_B],
      loading: false,
      error: null,
      refresh: mockRefresh as unknown as () => void,
    })
    render(<MetaOfficialTemplatesPanel />)
    await waitFor(() => expect(screen.getByText('hello_world')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Conta Meta'), { target: { value: FAKE_INSTANCE_B.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }))
    expect((screen.getByLabelText('Conta Meta') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Conta Meta'), { target: { value: FAKE_INSTANCE.id } })
    fireEvent.change(screen.getByPlaceholderText('pedido_enviado'), { target: { value: 'pedido_enviado' } })
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'Olá cliente' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação da Meta' }))
    await waitFor(() => expect(mockCreateTemplate).toHaveBeenCalledTimes(1))
    expect(mockCreateTemplate.mock.calls[0][0].instanceId).toBe(FAKE_INSTANCE_B.id)
    expect(mockCreateTemplate.mock.calls[0][0].instanceId).not.toBe(FAKE_INSTANCE.id)
  })
})
