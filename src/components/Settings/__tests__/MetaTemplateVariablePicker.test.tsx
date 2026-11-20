// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { MetaTemplateCreateForm } from '../MetaTemplateCreateForm'
import { metaWhatsAppApi } from '../../../services/metaWhatsAppApi'

vi.mock('../../../services/metaWhatsAppApi', () => ({
  metaWhatsAppApi: { createTemplate: vi.fn() },
}))

const mockCreate = metaWhatsAppApi.createTemplate as ReturnType<typeof vi.fn>

afterEach(cleanup)

function renderForm() {
  mockCreate.mockResolvedValue({
    id: '1',
    name: 'pedido_enviado',
    language: 'pt_BR',
    status: 'PENDING',
    category: 'UTILITY',
  })
  return render(
    <MetaTemplateCreateForm
      companyId="company-1"
      instanceId="inst-1"
      onCancel={vi.fn()}
      onCreated={vi.fn()}
    />,
  )
}

function fieldRoot(label: string) {
  return screen.getByLabelText(label).closest('div') as HTMLElement
}

function consultButton(label: string) {
  return within(fieldRoot(label)).getByRole('button', { name: 'Consultar variáveis' })
}

describe('MetaTemplateVariablePicker', () => {
  it('botão abre e fecha a lista', () => {
    renderForm()
    const button = consultButton('Mensagem')
    fireEvent.click(button)
    expect(screen.getByRole('listbox', { name: 'Variáveis do modelo' })).toBeTruthy()
    fireEvent.click(button)
    expect(screen.queryByRole('listbox', { name: 'Variáveis do modelo' })).toBeNull()
  })

  it('digitar {{ abre sugestões', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Mensagem'), {
      target: { value: 'Olá {{', selectionStart: 6, selectionEnd: 6 },
    })
    expect(screen.getByRole('listbox', { name: 'Variáveis do modelo' })).toBeTruthy()
  })

  it('busca filtra sugestões', () => {
    renderForm()
    fireEvent.click(consultButton('Mensagem'))
    fireEvent.change(screen.getByLabelText('Buscar variáveis'), { target: { value: 'agenda' } })
    expect(screen.getByText('Data do agendamento')).toBeTruthy()
    expect(screen.queryByText('Nome da empresa')).toBeNull()
    expect(screen.queryByText('Próxima variável posicional')).toBeNull()
  })

  it('Enter seleciona a opção ativa', async () => {
    renderForm()
    const ta = screen.getByLabelText('Mensagem') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'Olá {{', selectionStart: 6, selectionEnd: 6 } })
    fireEvent.keyDown(fieldRoot('Mensagem'), { key: 'Enter' })
    await waitFor(() => expect(ta.value).toBe('Olá {{1}}'))
  })

  it('Escape fecha as sugestões', () => {
    renderForm()
    fireEvent.click(consultButton('Mensagem'))
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.keyDown(fieldRoot('Mensagem'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('fecha ao clicar fora', () => {
    renderForm()
    fireEvent.click(consultButton('Mensagem'))
    expect(screen.getByRole('listbox')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('inserção no meio preserva texto posterior, emoji, quebra de linha e não duplica chaves', async () => {
    renderForm()
    const ta = screen.getByLabelText('Mensagem') as HTMLTextAreaElement
    fireEvent.change(ta, {
      target: { value: 'Olá 🙂{{ depois\nfim', selectionStart: 8, selectionEnd: 8 },
    })
    fireEvent.click(screen.getByRole('option', { name: /\{\{nome\}\}/ }))
    await waitFor(() => expect(ta.value).toBe('Olá 🙂{{nome}} depois\nfim'))
    expect(ta.value).not.toContain('{{{{')
  })

  it('índice posicional correto e sem lacunas', async () => {
    renderForm()
    const ta = screen.getByLabelText('Mensagem') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'A {{1}} B {{3}}', selectionStart: 15, selectionEnd: 15 } })
    fireEvent.click(consultButton('Mensagem'))
    expect(screen.getByText('{{2}}')).toBeTruthy()
    expect(screen.queryByText('{{4}}')).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Próxima variável posicional/ }))
    await waitFor(() => expect(ta.value.endsWith('{{2}}')).toBe(true))
  })

  it('formato nomeado válido e formatos não misturados', async () => {
    renderForm()
    const ta = screen.getByLabelText('Mensagem') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'Olá {{nome}} ', selectionStart: 13, selectionEnd: 13 } })
    fireEvent.click(consultButton('Mensagem'))
    expect(screen.getByText('{{data_agendamento}}')).toBeTruthy()
    expect(screen.queryByText('Próxima variável posicional')).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Data do agendamento/ }))
    await waitFor(() => expect(ta.value).toContain('{{data_agendamento}}'))
    expect(ta.value).not.toMatch(/\{\{\d+\}\}/)
  })

  it('HEADER respeita o limite de uma variável', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Cabeçalho (opcional)'), {
      target: { value: 'Olá {{1}}', selectionStart: 9, selectionEnd: 9 },
    })
    fireEvent.click(consultButton('Cabeçalho (opcional)'))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('O cabeçalho aceita no máximo uma variável.')).toBeTruthy()
  })
})
