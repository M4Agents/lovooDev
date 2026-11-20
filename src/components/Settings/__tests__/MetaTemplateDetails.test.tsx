// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MetaTemplateDetails } from '../MetaTemplateDetails'
import type { MetaAdminWhatsAppTemplate } from '../../../types/meta-whatsapp'
import { isSafePreviewUrl } from '../metaTemplateDetailsModel'

afterEach(cleanup)

const BASE: MetaAdminWhatsAppTemplate = {
  id:                  'tpl-base',
  name:                'base_template',
  language:            'pt_BR',
  status:              'APPROVED',
  category:            'UTILITY',
  parameter_format:    'POSITIONAL',
  components:          [{ type: 'BODY', text: 'Olá' }],
  parameters:          [],
  supported:           true,
  unsupported_reason:  null,
  header_media_format: null,
  buttons:             [],
}

function renderDetails(overrides: Partial<MetaAdminWhatsAppTemplate> = {}) {
  const onClose = vi.fn()
  const template = { ...BASE, ...overrides }
  render(<MetaTemplateDetails template={template} onClose={onClose} />)
  return { onClose, template }
}

function expandTech() {
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes técnicos' }))
}

describe('MetaTemplateDetails', () => {
  it('MTD-10: prévia visível e detalhes técnicos ocultos por padrão', () => {
    renderDetails({
      name: 'hello_world',
      language: 'pt_BR',
      category: 'MARKETING',
      components: [{ type: 'BODY', text: 'Olá {{1}}' }],
      parameters: [{ component: 'BODY', key: '1', position: 1, example: 'João' }],
    })
    expect(screen.getByText('Prévia da mensagem')).toBeTruthy()
    expect(screen.getByText('hello_world')).toBeTruthy()
    expect(screen.getByText(/pt_BR · MARKETING/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ver detalhes técnicos' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Detalhes técnicos')).toBeNull()
    expect(screen.queryByText(/exemplo: João/)).toBeNull()
    expect(screen.queryByText(/posição 1/)).toBeNull()
    expect(screen.queryByText(/^ID$/)).toBeNull()
    expect(screen.queryByText('Ausente')).toBeNull()
  })

  it('MTD-11: expandir e recolher detalhes técnicos', () => {
    renderDetails({
      components: [{ type: 'BODY', text: 'Olá {{1}}' }],
      parameters: [{ component: 'BODY', key: '1', position: 1, example: 'João' }],
    })
    expandTech()
    const openButton = screen.getByRole('button', { name: 'Ocultar detalhes técnicos' })
    expect(openButton.getAttribute('aria-expanded')).toBe('true')
    const regionId = openButton.getAttribute('aria-controls')
    expect(regionId).toBeTruthy()
    expect(document.getElementById(regionId as string)).toBeTruthy()
    expect(screen.getByText('Detalhes técnicos')).toBeTruthy()
    expect(document.body.textContent).toContain('exemplo: João')
    expect(document.body.textContent).toContain('posição 1')
    fireEvent.click(openButton)
    expect(screen.getByRole('button', { name: 'Ver detalhes técnicos' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Detalhes técnicos')).toBeNull()
    expect(screen.queryByText(/exemplo: João/)).toBeNull()
  })

  it('MTD-01: BODY longo, quebras e emoji aparecem por completo na prévia', () => {
    const body = 'Linha 1 😀\nLinha 2 com texto bem longo sem cortar o conteúdo original do modelo Meta.\nLinha 3'
    renderDetails({
      components: [{ type: 'BODY', text: body }],
    })
    expect(screen.getAllByText((_, node) => node?.textContent === body).length).toBeGreaterThan(0)
    expect(document.body.textContent).toContain('Linha 3')
    expect(document.body.textContent).toContain('😀')
    expect(screen.queryByText('Ausente')).toBeNull()
  })

  it('MTD-02: HEADER TEXT, FOOTER e fechar', () => {
    const { onClose } = renderDetails({
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Cabeçalho {{1}}' },
        { type: 'BODY', text: 'Corpo' },
        { type: 'FOOTER', text: 'Rodapé estático' },
      ],
    })
    expect(screen.getAllByText('Cabeçalho {{1}}').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rodapé estático').length).toBeGreaterThan(0)
    expect(screen.queryByText('Ausente')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /voltar à lista/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('MTD-03: Escape fecha os detalhes', () => {
    const { onClose } = renderDetails()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('MTD-04: fixture lovoo_e2e_image_quick_reply — prévia limpa; técnico após expandir', () => {
    renderDetails({
      id: 'tpl-img-qr',
      name: 'lovoo_e2e_image_quick_reply',
      header_media_format: 'IMAGE',
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: { header_handle: ['https://cdn.example.test/lovoo-e2e-image.jpg'] },
        },
        { type: 'BODY', text: 'Confira a imagem {{1}}', example: { body_text: [['João']] } },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Quero' },
            { type: 'QUICK_REPLY', text: 'Agora não' },
          ],
        },
      ],
      parameters: [{ component: 'BODY', key: '1', position: 1, example: 'João' }],
    })
    expect(screen.getByAltText('Prévia do cabeçalho').getAttribute('src')).toBe(
      'https://cdn.example.test/lovoo-e2e-image.jpg',
    )
    expect(screen.getAllByText('Quero').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Agora não').length).toBeGreaterThan(0)
    expect(screen.queryByText(/format: IMAGE/)).toBeNull()
    expect(screen.queryByText(/exemplo: João/)).toBeNull()
    expandTech()
    expect(document.body.textContent).toContain('exemplo: João')
    expect(document.body.textContent).toContain('format: IMAGE')
  })

  it('MTD-05: fixture lovoo_e2e_video — handle só nos detalhes técnicos', () => {
    renderDetails({
      name: 'lovoo_e2e_video',
      header_media_format: 'VIDEO',
      components: [
        { type: 'HEADER', format: 'VIDEO', example: { header_handle: ['4::aW1hZ2U'] } },
        { type: 'BODY', text: 'Vídeo do produto' },
      ],
    })
    expect(document.querySelector('video')).toBeNull()
    expect(document.body.textContent).toContain('A Meta não forneceu uma URL pública para prévia desta mídia.')
    expect(document.body.textContent).not.toContain('4::aW1hZ2U')
    expandTech()
    expect(document.body.textContent).toContain('4::aW1hZ2U')
  })

  it('MTD-06: fixture lovoo_e2e_document — botões na prévia; URL/telefone no técnico', () => {
    renderDetails({
      name: 'lovoo_e2e_document',
      header_media_format: 'DOCUMENT',
      parameter_format: 'POSITIONAL',
      components: [
        { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['https://cdn.example.test/catalogo.pdf'] } },
        { type: 'BODY', text: 'Baixe o catálogo' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'URL', text: 'Abrir', url: 'https://example.com/p/{{1}}', example: ['12345'] },
            { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5511988887777' },
            { type: 'QUICK_REPLY', text: 'Depois' },
          ],
        },
      ],
    })
    expect(screen.getByRole('link', { name: 'https://cdn.example.test/catalogo.pdf' })).toBeTruthy()
    expect(screen.getAllByText('Abrir').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ligar').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Depois').length).toBeGreaterThan(0)
    expect(screen.queryByText('+5511988887777')).toBeNull()
    expect(screen.queryByText('https://example.com/p/{{1}}')).toBeNull()
    expandTech()
    expect(document.body.textContent).toContain('https://example.com/p/{{1}}')
    expect(document.body.textContent).toContain('+5511988887777')
  })

  it('MTD-07: variáveis originais na prévia; exemplos só no técnico', () => {
    renderDetails({
      parameter_format: 'NAMED',
      components: [{ type: 'BODY', text: 'Olá {{first_name}} pedido {{order_id}}' }],
      parameters: [
        { component: 'BODY', key: 'first_name', position: null, example: 'Ana' },
        { component: 'BODY', key: 'order_id', position: null, example: 'ORD-1' },
      ],
    })
    expect(document.body.textContent).toContain('Olá {{first_name}} pedido {{order_id}}')
    expect(screen.queryByText(/exemplo: Ana/)).toBeNull()
    expandTech()
    expect(document.body.textContent).toContain('first_name')
    expect(document.body.textContent).toContain('exemplo: Ana')
    expect(document.body.textContent).toContain('order_id')
  })

  it('MTD-08: componente desconhecido — resumo na prévia; dump após expandir', () => {
    renderDetails({
      name: 'carousel_demo',
      supported: false,
      unsupported_reason: 'carousel_not_supported',
      rejected_reason: 'INCORRECT_CATEGORY',
      components: [
        { type: 'BODY', text: 'Ofertas' },
        { type: 'CAROUSEL', cards: [{ text: 'Card 1 completo' }, { text: 'Card 2 completo' }] },
      ],
    })
    expect(document.body.textContent).toContain('Componente adicional: CAROUSEL')
    expect(document.body.textContent).toContain('não é suportado para envio no chat')
    expect(document.body.textContent).toContain('INCORRECT_CATEGORY')
    expect(screen.queryByText(/Card 1 completo/)).toBeNull()
    expandTech()
    expect(document.body.textContent).toContain('Card 1 completo')
    expect(document.body.textContent).toContain('Card 2 completo')
    expect(document.body.textContent).toContain('carousel_not_supported')
  })

  it('MTD-09: não renderiza HTML da Meta e não vaza token', () => {
    renderDetails({
      components: [{ type: 'BODY', text: '<img src=x onerror=alert(1)> EAA-fake-should-not-exec' }],
    })
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(document.body.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(document.body.textContent).not.toContain('EAAFakeToken')
  })
})

describe('isSafePreviewUrl', () => {
  it('aceita http/https e rejeita javascript', () => {
    expect(isSafePreviewUrl('https://cdn.example.test/a.jpg')).toBe(true)
    expect(isSafePreviewUrl('http://cdn.example.test/a.jpg')).toBe(true)
    expect(isSafePreviewUrl('javascript:alert(1)')).toBe(false)
    expect(isSafePreviewUrl('4::handle')).toBe(false)
  })
})
