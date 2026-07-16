// =============================================================================
// src/components/Automation/forms/__tests__/DelayForm.helpers.test.ts
//
// Testes unitários dos helpers puros exportados de DelayForm.tsx.
//
// NOTA SOBRE INFRAESTRUTURA:
//   Este projeto não possui @testing-library/react nem jsdom instalados.
//   Portanto, apenas as funções puras exportadas pelo componente são testadas aqui.
//
//   Os seguintes casos requerem infraestrutura de renderização React (DOM) e
//   NÃO são cobertos neste arquivo:
//     - Renderização do seletor de modo
//     - Exibição condicional de response_variable no DOM
//     - Exibição de avisos de troca de modo
//     - Comportamento de inputs controlados e chamadas a onChange
//     - Verificação de que edges não são alteradas
//
//   Para habilitá-los instale: @testing-library/react + @vitest/browser ou jsdom.
//
// COBERTURA (helpers puros):
//   TC-F01 a TC-F06  — resolveWaitMode
//   TC-F07 a TC-F12  — normalizeResponseVariable
//   TC-F13 a TC-F14  — tipos TypeScript (verificados em compilação)
// =============================================================================

import { describe, it, expect } from 'vitest'
import { resolveWaitMode, normalizeResponseVariable } from '../DelayForm'

// =============================================================================
// resolveWaitMode
// =============================================================================

describe('resolveWaitMode', () => {
  it('TC-F01: wait_mode ausente → time (modo legado)', () => {
    expect(resolveWaitMode({})).toBe('time')
  })

  it('TC-F02: wait_mode=time → time', () => {
    expect(resolveWaitMode({ wait_mode: 'time' })).toBe('time')
  })

  it('TC-F03: wait_mode=time_or_response → time_or_response', () => {
    expect(resolveWaitMode({ wait_mode: 'time_or_response' })).toBe('time_or_response')
  })

  it('TC-F04: wait_mode=null → time (fallback defensivo)', () => {
    expect(resolveWaitMode({ wait_mode: null })).toBe('time')
  })

  it('TC-F05: wait_mode desconhecido → time (fallback defensivo)', () => {
    expect(resolveWaitMode({ wait_mode: 'unknown_mode' })).toBe('time')
  })

  it('TC-F06: config legada não é alterada apenas ao chamar resolveWaitMode', () => {
    const config = { duration: 10, unit: 'minutes' }
    const mode = resolveWaitMode(config)
    expect(mode).toBe('time')
    // config não deve ter sido mutado
    expect((config as any).wait_mode).toBeUndefined()
  })
})

// =============================================================================
// normalizeResponseVariable
// =============================================================================

describe('normalizeResponseVariable', () => {
  it('TC-F07: string com conteúdo → retorna string trimada', () => {
    expect(normalizeResponseVariable('resposta_lead')).toBe('resposta_lead')
  })

  it('TC-F08: string com espaços nas bordas → retorna trimada', () => {
    expect(normalizeResponseVariable('  resposta_lead  ')).toBe('resposta_lead')
  })

  it('TC-F09: string vazia → null', () => {
    expect(normalizeResponseVariable('')).toBeNull()
  })

  it('TC-F10: string apenas com espaços → null', () => {
    expect(normalizeResponseVariable('   ')).toBeNull()
  })

  it('TC-F11: null → null', () => {
    expect(normalizeResponseVariable(null)).toBeNull()
  })

  it('TC-F12: undefined → null', () => {
    expect(normalizeResponseVariable(undefined)).toBeNull()
  })

  it('TC-F13: valor com underscores e letras → preservado', () => {
    expect(normalizeResponseVariable('minha_variavel_123')).toBe('minha_variavel_123')
  })

  it('TC-F14: salvar campo vazio não bloqueia (resulta em null, não lança erro)', () => {
    expect(() => normalizeResponseVariable('')).not.toThrow()
    expect(normalizeResponseVariable('')).toBeNull()
  })
})

// =============================================================================
// Verificação de tipos TypeScript (TC-F15 a TC-F17)
// — Validação em tempo de compilação; se houver erro de tipo, tsc falha.
// =============================================================================

describe('Tipos TypeScript — DelayForm helpers', () => {
  it('TC-F15: WaitMode aceita time e time_or_response', () => {
    const modeTime: import('../DelayForm').WaitMode = 'time'
    const modeTor: import('../DelayForm').WaitMode = 'time_or_response'
    expect(modeTime).toBe('time')
    expect(modeTor).toBe('time_or_response')
  })

  it('TC-F16: resolveWaitMode retorna tipo WaitMode estrito', () => {
    const mode = resolveWaitMode({ wait_mode: 'time_or_response' })
    const check: import('../DelayForm').WaitMode = mode
    expect(check).toBe('time_or_response')
  })

  it('TC-F17: normalizeResponseVariable retorna string | null (nunca undefined)', () => {
    const a = normalizeResponseVariable('x')
    const b = normalizeResponseVariable('')
    // Se o tipo estivesse errado, tsc emitiria erro
    const _a: string | null = a
    const _b: string | null = b
    expect(_a).toBe('x')
    expect(_b).toBeNull()
  })
})
