// =============================================================================
// src/components/Automation/nodes/__tests__/DelayNode.helpers.test.ts
//
// Testes unitários dos helpers puros exportados de DelayNode.tsx.
//
// NOTA SOBRE INFRAESTRUTURA:
//   Este projeto não possui @testing-library/react nem jsdom instalados.
//   Apenas as funções puras exportadas são testadas aqui.
//
//   Os seguintes casos requerem infraestrutura de renderização React (DOM) e
//   NÃO são cobertos neste arquivo:
//     - Renderização condicional do handle "next" (modo legado)
//     - Renderização condicional dos handles "responded" e "timeout" (novo modo)
//     - Verificação de IDs dos handles no DOM
//     - Ausência de handle "next" no modo time_or_response
//     - Ausência de handles "responded"/"timeout" no modo legado
//     - Handles visíveis sem edges conectadas
//     - Propriedades aria-label e title dos handles
//
//   Para habilitá-los instale: @testing-library/react + @vitest/browser ou jsdom.
//
// COBERTURA (helpers puros):
//   TC-N01 a TC-N08  — getUnitLabel
//   TC-N09 a TC-N21  — getDelayPreview
//   TC-N22 a TC-N25  — casos defensivos (config inválida/antigo flow)
// =============================================================================

import { describe, it, expect } from 'vitest'
import { getUnitLabel, getDelayPreview } from '../DelayNode'

// =============================================================================
// getUnitLabel
// =============================================================================

describe('getUnitLabel', () => {
  it('TC-N01: seconds → segundo(s)', () => {
    expect(getUnitLabel('seconds')).toBe('segundo(s)')
  })

  it('TC-N02: minutes → minuto(s)', () => {
    expect(getUnitLabel('minutes')).toBe('minuto(s)')
  })

  it('TC-N03: hours → hora(s)', () => {
    expect(getUnitLabel('hours')).toBe('hora(s)')
  })

  it('TC-N04: days → dia(s)', () => {
    expect(getUnitLabel('days')).toBe('dia(s)')
  })

  it('TC-N05: unidade desconhecida → fallback minuto(s)', () => {
    expect(getUnitLabel('weeks')).toBe('minuto(s)')
  })

  it('TC-N06: undefined → fallback minuto(s)', () => {
    expect(getUnitLabel(undefined)).toBe('minuto(s)')
  })

  it('TC-N07: string vazia → fallback minuto(s)', () => {
    expect(getUnitLabel('')).toBe('minuto(s)')
  })

  it('TC-N08: não lança erro para qualquer entrada de string', () => {
    expect(() => getUnitLabel('qualquer_coisa')).not.toThrow()
  })
})

// =============================================================================
// getDelayPreview — modo legado (wait_mode ausente ou 'time')
// =============================================================================

describe('getDelayPreview — modo legado', () => {
  it('TC-N09: config sem wait_mode e duration válida → preview legado', () => {
    const result = getDelayPreview({ duration: 15, unit: 'minutes' })
    expect(result).toBe('Aguardar 15 minuto(s)')
    expect(result).not.toContain('Resp.')
  })

  it('TC-N10: wait_mode=time → preview legado', () => {
    const result = getDelayPreview({ wait_mode: 'time', duration: 10, unit: 'hours' })
    expect(result).toBe('Aguardar 10 hora(s)')
  })

  it('TC-N11: preview legado permanece inalterado para flows antigos', () => {
    const oldFlow = { duration: 5, unit: 'days' }
    expect(getDelayPreview(oldFlow)).toBe('Aguardar 5 dia(s)')
  })

  it('TC-N12: duration ausente → placeholder de configuração (sem crash)', () => {
    const result = getDelayPreview({ unit: 'minutes' })
    expect(result).toBe('Clique para configurar tempo')
    expect(typeof result).toBe('string')
  })

  it('TC-N13: duration=0 → placeholder (não usa 0 como valor válido)', () => {
    const result = getDelayPreview({ duration: 0, unit: 'minutes' })
    expect(result).toBe('Clique para configurar tempo')
  })

  it('TC-N14: duration negativa → placeholder', () => {
    const result = getDelayPreview({ duration: -5, unit: 'minutes' })
    expect(result).toBe('Clique para configurar tempo')
  })

  it('TC-N15: unidade inválida → não causa crash, usa fallback', () => {
    expect(() => getDelayPreview({ duration: 3, unit: 'weeks' })).not.toThrow()
    const result = getDelayPreview({ duration: 3, unit: 'weeks' })
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('TC-N16: wait_mode desconhecido → trata como modo legado', () => {
    const result = getDelayPreview({ wait_mode: 'unknown', duration: 5, unit: 'minutes' })
    // Deve usar o caminho legado (não começa com "Resp.")
    expect(result).toBe('Aguardar 5 minuto(s)')
  })
})

// =============================================================================
// getDelayPreview — novo modo (wait_mode=time_or_response)
// =============================================================================

describe('getDelayPreview — modo time_or_response', () => {
  it('TC-N17: novo modo com duration válida → preview com "Resp. ou"', () => {
    const result = getDelayPreview({ wait_mode: 'time_or_response', duration: 15, unit: 'minutes' })
    expect(result).toBe('Resp. ou 15 minuto(s)')
    expect(result).not.toContain('Aguardar ')
  })

  it('TC-N18: novo modo com hours → preview correto', () => {
    const result = getDelayPreview({ wait_mode: 'time_or_response', duration: 2, unit: 'hours' })
    expect(result).toBe('Resp. ou 2 hora(s)')
  })

  it('TC-N19: novo modo com days → preview correto', () => {
    const result = getDelayPreview({ wait_mode: 'time_or_response', duration: 1, unit: 'days' })
    expect(result).toBe('Resp. ou 1 dia(s)')
  })

  it('TC-N20: novo modo sem duration → placeholder específico', () => {
    const result = getDelayPreview({ wait_mode: 'time_or_response' })
    expect(result).toBe('Configurar tempo de espera')
  })

  it('TC-N21: labels não dependem de response_variable', () => {
    const semVar = getDelayPreview({ wait_mode: 'time_or_response', duration: 5, unit: 'minutes' })
    const comVar = getDelayPreview({ wait_mode: 'time_or_response', duration: 5, unit: 'minutes', response_variable: 'resposta' })
    expect(semVar).toBe(comVar)
  })
})

// =============================================================================
// Casos defensivos
// =============================================================================

describe('getDelayPreview — defensivo', () => {
  it('TC-N22: config null → não causa crash', () => {
    expect(() => getDelayPreview(null)).not.toThrow()
  })

  it('TC-N23: config undefined → não causa crash', () => {
    expect(() => getDelayPreview(undefined)).not.toThrow()
  })

  it('TC-N24: config sem nenhum campo → retorna string não-vazia', () => {
    const result = getDelayPreview({})
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('TC-N25: flow antigo (sem wait_mode) renderiza sem regressão', () => {
    // Simula config típica de flow antigo importado
    const legacyConfig = { duration: 30, unit: 'minutes', business_hours_only: true }
    const result = getDelayPreview(legacyConfig)
    expect(result).toBe('Aguardar 30 minuto(s)')
  })
})
