import { describe, expect, it } from 'vitest'
import {
  isSafeHistoricalHref,
  sanitizeHistoricalTemplateButtons,
} from '../historicalTemplateButtons'

const QR = { type: 'QUICK_REPLY' as const, index: 0, text: 'Sim' }
const URL_BTN = {
  type:  'URL' as const,
  index: 0,
  text:  'Abrir teste',
  href:  'https://example.com/test/12345',
}

describe('sanitizeHistoricalTemplateButtons', () => {
  it('null → null', () => {
    expect(sanitizeHistoricalTemplateButtons(null)).toBeNull()
  })

  it('undefined → null', () => {
    expect(sanitizeHistoricalTemplateButtons(undefined)).toBeNull()
  })

  it('non-array → null', () => {
    expect(sanitizeHistoricalTemplateButtons('qr')).toBeNull()
    expect(sanitizeHistoricalTemplateButtons(1)).toBeNull()
    expect(sanitizeHistoricalTemplateButtons({ type: 'QUICK_REPLY' })).toBeNull()
  })

  it('[] → null', () => {
    expect(sanitizeHistoricalTemplateButtons([])).toBeNull()
  })

  it('QR válido', () => {
    expect(sanitizeHistoricalTemplateButtons([QR])).toEqual([QR])
  })

  it('múltiplos QR', () => {
    const a = { type: 'QUICK_REPLY', index: 1, text: 'Não' }
    const b = { type: 'QUICK_REPLY', index: 0, text: 'Sim' }
    expect(sanitizeHistoricalTemplateButtons([a, b])).toEqual([a, b])
  })

  it('URL válida', () => {
    expect(sanitizeHistoricalTemplateButtons([URL_BTN])).toEqual([URL_BTN])
  })

  it('mixed QR + URL válidos', () => {
    expect(sanitizeHistoricalTemplateButtons([QR, URL_BTN])).toEqual([QR, URL_BTN])
  })

  it('unknown type dropado', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'PHONE_NUMBER', index: 0, text: 'Ligar' },
      QR,
    ])).toEqual([QR])
  })

  it('todos inválidos → null', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'PHONE_NUMBER', index: 0, text: 'Ligar' },
      { type: 'QUICK_REPLY', index: 99, text: 'X' },
    ])).toBeNull()
  })

  it('QR com propriedade própria payload → drop', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'QUICK_REPLY', index: 0, text: 'Sim', payload: 'lovoo:qr:v1:x:pt_BR:0' },
    ])).toBeNull()
  })

  it('campos extras → whitelist (não copia)', () => {
    const raw = {
      type:      'QUICK_REPLY',
      index:     0,
      text:      'Sim',
      url:       'https://evil.example',
      url_kind:  'dynamic',
      extra:     true,
    }
    expect(sanitizeHistoricalTemplateButtons([raw])).toEqual([QR])
  })

  it('index inválido dropado', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'QUICK_REPLY', index: -1, text: 'Sim' },
      { type: 'QUICK_REPLY', index: 10, text: 'Sim' },
      { type: 'QUICK_REPLY', index: 1.5, text: 'Sim' },
      { type: 'QUICK_REPLY', index: '0', text: 'Sim' },
    ])).toBeNull()
  })

  it('text vazio / whitespace dropado', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'QUICK_REPLY', index: 0, text: '' },
      { type: 'QUICK_REPLY', index: 1, text: '   ' },
    ])).toBeNull()
  })

  it('text > 64 dropado', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'QUICK_REPLY', index: 0, text: 'x'.repeat(65) },
    ])).toBeNull()
  })

  it('javascript: URL dropada', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'X', href: 'javascript:alert(1)' },
    ])).toBeNull()
  })

  it('data: URL dropada', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'X', href: 'data:text/html,hi' },
    ])).toBeNull()
  })

  it('blob: URL dropada', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'X', href: 'blob:https://example.com/abc' },
    ])).toBeNull()
  })

  it('file: URL dropada', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'X', href: 'file:///tmp/x' },
    ])).toBeNull()
  })

  it('relative URL dropada', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'X', href: '/relative/path' },
    ])).toBeNull()
  })

  it('malformed URL dropada', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'X', href: 'https://' },
    ])).toBeNull()
  })

  it('credentials URL dropada', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'X', href: 'https://user:pass@example.com/' },
    ])).toBeNull()
  })

  it('href > 2048 dropada', () => {
    const href = `https://example.com/${'a'.repeat(2048)}`
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'X', href },
    ])).toBeNull()
  })

  it('wrapper { v, buttons } → null', () => {
    expect(sanitizeHistoricalTemplateButtons({
      v: 1,
      buttons: [QR],
    })).toBeNull()
  })

  it('href original preservado (sem toString/normalização)', () => {
    const href = 'https://EXAMPLE.com/test/12345'
    const out = sanitizeHistoricalTemplateButtons([
      { type: 'URL', index: 0, text: 'Abrir', href },
    ])
    expect(out).toEqual([{ type: 'URL', index: 0, text: 'Abrir', href }])
    expect(out?.[0] && out[0].type === 'URL' ? out[0].href : null).toBe(href)
  })

  it('não lança em entrada arbitrária', () => {
    expect(() => sanitizeHistoricalTemplateButtons(undefined)).not.toThrow()
    expect(() => sanitizeHistoricalTemplateButtons({ v: 1, buttons: [QR] })).not.toThrow()
    expect(() => sanitizeHistoricalTemplateButtons([null, 1, 'x', { type: 'URL' }])).not.toThrow()
  })
})

describe('isSafeHistoricalHref', () => {
  it('aceita http/https com hostname', () => {
    expect(isSafeHistoricalHref('https://example.com/test/12345')).toBe(true)
    expect(isSafeHistoricalHref('http://example.com/a')).toBe(true)
  })

  it('rejeita javascript/data/blob/file/relative/credentials', () => {
    expect(isSafeHistoricalHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHistoricalHref('data:text/html,hi')).toBe(false)
    expect(isSafeHistoricalHref('blob:https://example.com/abc')).toBe(false)
    expect(isSafeHistoricalHref('file:///tmp/x')).toBe(false)
    expect(isSafeHistoricalHref('/relative')).toBe(false)
    expect(isSafeHistoricalHref('https://user:pass@example.com/')).toBe(false)
  })
})
