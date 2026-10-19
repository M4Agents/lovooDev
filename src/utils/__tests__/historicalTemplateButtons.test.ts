import { describe, expect, it } from 'vitest'
import {
  buildHistoricalTelHref,
  isSafeHistoricalHref,
  isSafeHistoricalPhoneNumber,
  sanitizeHistoricalTemplateButtons,
} from '../historicalTemplateButtons'

const QR = { type: 'QUICK_REPLY' as const, index: 0, text: 'Sim' }
const URL_BTN = {
  type:  'URL' as const,
  index: 0,
  text:  'Abrir teste',
  href:  'https://example.com/test/12345',
}
const PHONE = {
  type:         'PHONE_NUMBER' as const,
  index:        0,
  text:         'Ligar',
  phone_number: '+5511999999999',
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
      { type: 'FLOW', index: 0, text: 'Abrir' },
      QR,
    ])).toEqual([QR])
  })

  it('todos inválidos → null', () => {
    expect(sanitizeHistoricalTemplateButtons([
      { type: 'FLOW', index: 0, text: 'Abrir' },
      { type: 'QUICK_REPLY', index: 99, text: 'X' },
    ])).toBeNull()
  })

  it('PHONE_NUMBER válido', () => {
    expect(sanitizeHistoricalTemplateButtons([PHONE])).toEqual([PHONE])
  })

  it('PHONE_NUMBER extras descartados por whitelist', () => {
    const raw = {
      type:         'PHONE_NUMBER',
      index:        0,
      text:         'Ligar',
      phone_number: '+5511999999999',
      extra:        'nope',
      href:         'tel:+5511999999999',
      payload:      'x',
    }
    expect(sanitizeHistoricalTemplateButtons([raw])).toEqual([PHONE])
    expect(sanitizeHistoricalTemplateButtons([raw])?.[0]).not.toHaveProperty('extra')
    expect(sanitizeHistoricalTemplateButtons([raw])?.[0]).not.toHaveProperty('href')
    expect(sanitizeHistoricalTemplateButtons([raw])?.[0]).not.toHaveProperty('payload')
  })

  it.each([
    ['ausente', { type: 'PHONE_NUMBER', index: 0, text: 'Ligar' }],
    ['javascript:', { type: 'PHONE_NUMBER', index: 0, text: 'Ligar', phone_number: 'javascript:alert(1)' }],
    ['data:', { type: 'PHONE_NUMBER', index: 0, text: 'Ligar', phone_number: 'data:text/html,hi' }],
    ['tel: pronto', { type: 'PHONE_NUMBER', index: 0, text: 'Ligar', phone_number: 'tel:+5511999999999' }],
    ['espaços', { type: 'PHONE_NUMBER', index: 0, text: 'Ligar', phone_number: '+55 11 99999-9999' }],
    ['barra', { type: 'PHONE_NUMBER', index: 0, text: 'Ligar', phone_number: '+5511/99999999' }],
    ['arroba', { type: 'PHONE_NUMBER', index: 0, text: 'Ligar', phone_number: '+55@1199999999' }],
    ['longo', { type: 'PHONE_NUMBER', index: 0, text: 'Ligar', phone_number: `+${'1'.repeat(21)}` }],
  ])('PHONE_NUMBER inválido (%s) dropado', (_label, raw) => {
    expect(sanitizeHistoricalTemplateButtons([raw, QR])).toEqual([QR])
    expect(sanitizeHistoricalTemplateButtons([raw])).toBeNull()
  })

  it('mixed QR + URL + PHONE preserva ordem de entrada', () => {
    expect(sanitizeHistoricalTemplateButtons([URL_BTN, PHONE, QR])).toEqual([
      URL_BTN, PHONE, QR,
    ])
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

describe('buildHistoricalTelHref / isSafeHistoricalPhoneNumber', () => {
  it('número válido → tel: sem normalizar', () => {
    expect(isSafeHistoricalPhoneNumber('+5511999999999')).toBe(true)
    expect(buildHistoricalTelHref('+5511999999999')).toBe('tel:+5511999999999')
    expect(buildHistoricalTelHref('5511999999999')).toBe('tel:5511999999999')
  })

  it('rejeita javascript/data/tel pronto/espaços/barra/arroba/comprimento', () => {
    expect(buildHistoricalTelHref('javascript:alert(1)')).toBeNull()
    expect(buildHistoricalTelHref('data:text/html,hi')).toBeNull()
    expect(buildHistoricalTelHref('tel:+5511999999999')).toBeNull()
    expect(buildHistoricalTelHref('+55 11 99999-9999')).toBeNull()
    expect(buildHistoricalTelHref('+5511/99999999')).toBeNull()
    expect(buildHistoricalTelHref('+55@1199999999')).toBeNull()
    expect(buildHistoricalTelHref(`+${'1'.repeat(21)}`)).toBeNull()
    expect(isSafeHistoricalPhoneNumber('javascript:alert(1)')).toBe(false)
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
