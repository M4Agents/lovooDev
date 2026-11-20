import { describe, it, expect } from 'vitest'
import {
  buildMetaVariableSuggestions,
  classifyTemplateFormat,
  detectOpenTrigger,
  filterSuggestions,
  insertMetaPlaceholder,
  isInsideCompletePlaceholder,
  nextPositionalIndex,
  placeholderKey,
} from '../metaTemplateVariableCatalog'
import { buildGraphCreatePayload } from '../../../../api/lib/meta-whatsapp/templateCreate.js'

describe('metaTemplateVariableCatalog', () => {
  it('índice posicional começa em 1 e segue a sequência', () => {
    expect(nextPositionalIndex([])).toBe(1)
    expect(nextPositionalIndex(['1'])).toBe(2)
    expect(nextPositionalIndex(['1', '2'])).toBe(3)
  })

  it('não cria lacunas posicionais — preenche o primeiro índice ausente', () => {
    expect(nextPositionalIndex(['1', '3'])).toBe(2)
    expect(nextPositionalIndex(['2'])).toBe(1)
  })

  it('não duplica índice já usado no campo', () => {
    const options = buildMetaVariableSuggestions({
      component: 'body',
      headerText: '',
      bodyText: 'Olá {{1}}',
    })
    expect(options.some((item) => item.syntax === '{{1}}')).toBe(false)
    expect(options.find((item) => item.kind === 'positional')?.syntax).toBe('{{2}}')
  })

  it('formato nomeado válido e sem misturar com posicional', () => {
    expect(classifyTemplateFormat(['nome', 'data_agendamento'])).toBe('NAMED')
    expect(classifyTemplateFormat(['1', 'nome'])).toBe('MIXED')
    const namedLocked = buildMetaVariableSuggestions({
      component: 'body',
      headerText: '',
      bodyText: 'Olá {{nome}}',
    })
    expect(namedLocked.every((item) => item.kind === 'named')).toBe(true)
    expect(namedLocked.some((item) => item.syntax === '{{nome}}')).toBe(false)
    const mixed = buildMetaVariableSuggestions({
      component: 'body',
      headerText: '',
      bodyText: 'Olá {{1}} {{nome}}',
    })
    expect(mixed).toEqual([])
  })

  it('insere no meio, preserva texto posterior, emoji e quebra de linha, sem duplicar chaves', () => {
    const source = 'Olá 🙂\ndepois'
    const from = source.indexOf('\n')
    const withTrigger = source.slice(0, from) + '{{' + source.slice(from)
    const trigger = detectOpenTrigger(withTrigger, from + 2)
    expect(trigger).toEqual({ query: '', from })
    const inserted = insertMetaPlaceholder(withTrigger, trigger!.from, from + 2, '{{nome}}')
    expect(inserted.text).toBe('Olá 🙂{{nome}}\ndepois')
    expect(inserted.text).not.toContain('{{{{')
    expect(inserted.text).toContain('🙂')
    expect(inserted.text).toContain('\n')
  })

  it('não abre sugestão dentro de variável completa', () => {
    const text = 'Olá {{nome}}!'
    const inner = text.indexOf('no') + 2
    expect(isInsideCompletePlaceholder(text, inner)).toBe(true)
    expect(detectOpenTrigger(text, inner)).toBeNull()
    expect(detectOpenTrigger('Olá {{', 6)).toEqual({ query: '', from: 4 })
  })

  it('payload Graph permanece compatível após inserção nomeada', () => {
    const result = buildGraphCreatePayload({
      name: 'pedido_enviado',
      language: 'pt_BR',
      category: 'UTILITY',
      header_text: '',
      body_text: 'Olá {{nome}}, {{data_agendamento}} na {{nome_empresa}}.',
      footer_text: '',
      examples: {
        body: {
          nome: 'João',
          data_agendamento: '20/11/2026',
          nome_empresa: 'Lovoo',
        },
      },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.parameter_format).toBe('NAMED')
      expect(placeholderKey('{{nome}}')).toBe('nome')
    }
  })

  it('filtra sugestões pela busca', () => {
    const options = buildMetaVariableSuggestions({
      component: 'body',
      headerText: '',
      bodyText: '',
    })
    const filtered = filterSuggestions(options, 'agenda')
    expect(filtered.map((item) => item.id)).toEqual(['data_agendamento'])
  })
})
