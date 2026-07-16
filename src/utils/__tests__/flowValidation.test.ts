// =============================================================================
// src/utils/__tests__/flowValidation.test.ts
//
// Testes unitários — validateFlow (flowValidation.ts)
//
// Framework: vitest
// Foco: validação de nós Delay — modo legado e novo modo time_or_response.
//
// Estrutura dos casos:
//   TC-01 a TC-06  — compatibilidade backward (flows antigos)
//   TC-07 a TC-14  — novo modo time_or_response: regras de handles
//   TC-15 a TC-17  — duração em todos os modos
//   TC-18 a TC-20  — response_variable (campo opcional)
//   TC-21 a TC-22  — flow importado antigo / node duplicado sem edges
//   TC-23 a TC-24  — isolamento de edges (outro nó / edges de entrada)
//   TC-25 a TC-26  — isValid e warnings
//   TC-27 a TC-30  — sem regressão em outros tipos de nó
//   TC-31 a TC-34  — troca de modo (time_or_response → time)
//   TC-35 a TC-36  — três ou mais edges no novo modo
//   Tipos TS        — verificados em tempo de compilação via assignments
// =============================================================================

import { describe, it, expect } from 'vitest'
import type { Node, Edge } from 'reactflow'
import { validateFlow } from '../flowValidation'

// ---------------------------------------------------------------------------
// Helpers de criação de fixtures
// ---------------------------------------------------------------------------

function makeNode(
  id: string,
  type: string,
  config: Record<string, unknown> = {},
  label = type,
): Node {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label, config },
  } as Node
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string | null,
): Edge {
  return { id, source, target, sourceHandle } as Edge
}

/** Nó start mínimo com um trigger configurado (evita erros de setup no flow) */
function makeStart(id = 'start-1'): Node {
  return {
    id,
    type: 'start',
    position: { x: 0, y: 0 },
    data: { label: 'Início', config: {}, triggers: [{ id: 'trig-1' }] },
  } as Node
}

/** Nó end mínimo */
const END = makeNode('end-1', 'end', {}, 'Fim')

/** Config legada básica de delay (sem wait_mode) */
const LEGACY_CONFIG = { duration: 15, unit: 'minutes' }

/** Config legada explícita com wait_mode=time */
const TIME_CONFIG = { duration: 10, unit: 'hours', wait_mode: 'time' }

/** Config do novo modo */
const TOR_CONFIG = { duration: 30, unit: 'minutes', wait_mode: 'time_or_response' }

/** Config do novo modo com response_variable */
const TOR_WITH_VAR = { ...TOR_CONFIG, response_variable: 'resposta_lead' }

// Delay node helpers
const delayId = 'delay-1'
const makeDelay = (config: Record<string, unknown>) =>
  makeNode(delayId, 'delay', config, 'Aguardar')

// Edges canonicas para o novo modo
const edgeResponded = makeEdge('e-resp', delayId, 'end-1', 'responded')
const edgeTimeout   = makeEdge('e-tout', delayId, 'end-1', 'timeout')

// Edge legada (next)
const edgeNext = makeEdge('e-next', delayId, 'end-1', 'next')

// Edge sem handle (null / undefined)
const edgeNullHandle      = makeEdge('e-null', delayId, 'end-1', null)
const edgeUndefinedHandle = makeEdge('e-undef', delayId, 'end-1', undefined)

// =============================================================================
// TC-01 a TC-06 — Compatibilidade backward (flows antigos)
// =============================================================================

describe('Compatibilidade backward — flows antigos', () => {
  it('TC-01: delay sem wait_mode + edge next → válido (modo legado)', () => {
    const nodes = [makeStart(), makeDelay(LEGACY_CONFIG), END]
    const edges = [edgeNext]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-02: delay com wait_mode=time + edge next → válido (modo legado)', () => {
    const nodes = [makeStart(), makeDelay(TIME_CONFIG), END]
    const edges = [edgeNext]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-03: delay legado com edge next permanece válido (sem regressão)', () => {
    const nodes = [makeStart(), makeDelay(LEGACY_CONFIG), END]
    const edges = [edgeNext]
    const result = validateFlow(nodes, edges)
    // Nenhum erro gerado especificamente para o nó delay
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-04: flow importado antigo sem wait_mode não sofre regressão', () => {
    // Simula um flow antigo importado com edge sem handle (edge simples sem campo sourceHandle)
    const nodes = [makeStart(), makeDelay(LEGACY_CONFIG), END]
    const edgeSimples = makeEdge('e-simples', delayId, 'end-1', undefined)
    const edges = [edgeSimples]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-05: delay legado com edge sourceHandle=null → válido (não é novo modo)', () => {
    const nodes = [makeStart(), makeDelay(LEGACY_CONFIG), END]
    const edges = [edgeNullHandle]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-06: delay com wait_mode=time sem edges → sem erros de handle (apenas warning de sem conexão)', () => {
    const nodes = [makeStart(), makeDelay(TIME_CONFIG), END]
    const result = validateFlow(nodes, [], )
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    // O modo legado não exige handles — apenas duração
    expect(delayErrors).toHaveLength(0)
  })
})

// =============================================================================
// TC-07 a TC-14 — Novo modo time_or_response: regras de handles
// =============================================================================

describe('Novo modo time_or_response — regras de handles', () => {
  it('TC-07: responded + timeout exatos → válido (estado estrutural correto)', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
    expect(result.isValid).toBe(true)
  })

  it('TC-08: sem responded → erro bloqueante', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeTimeout] // sem responded
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('Lead respondeu'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-09: sem timeout → erro bloqueante', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded] // sem timeout
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('timeout') || e.message.includes('Sem resposta'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-10: handle "next" presente → erro bloqueante (conversão incompleta)', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeTimeout, edgeNext]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('"next"'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-11: edge sem sourceHandle (null) → erro bloqueante', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeTimeout, edgeNullHandle]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('incompatíveis'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-12: edge sem sourceHandle (undefined) → erro bloqueante', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeTimeout, edgeUndefinedHandle]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('incompatíveis'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-13: handle desconhecido (ex: "true") → erro bloqueante', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edgeBad = makeEdge('e-bad', delayId, 'end-1', 'true')
    const edges = [edgeResponded, edgeTimeout, edgeBad]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('incompatíveis'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-14: dois responded → erro bloqueante', () => {
    const edgeResp2 = makeEdge('e-resp-2', delayId, 'end-1', 'responded')
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeResp2, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('mais de uma') && e.message.includes('respondeu'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-14b: dois timeout → erro bloqueante', () => {
    const edgeTout2 = makeEdge('e-tout-2', delayId, 'end-1', 'timeout')
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeTimeout, edgeTout2]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('mais de uma') && e.message.includes('timeout'))).toBe(true)
    expect(result.isValid).toBe(false)
  })
})

// =============================================================================
// TC-15 a TC-17 — Duração em todos os modos
// =============================================================================

describe('Duração obrigatória', () => {
  it('TC-15: duration=0 → erro bloqueante (modo legado)', () => {
    const nodes = [makeStart(), makeDelay({ duration: 0, unit: 'minutes' }), END]
    const result = validateFlow(nodes, [edgeNext])
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('duração'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-16: duration negativa → erro bloqueante (modo legado)', () => {
    const nodes = [makeStart(), makeDelay({ duration: -5, unit: 'minutes' }), END]
    const result = validateFlow(nodes, [edgeNext])
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('duração'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-17: duration ausente → erro bloqueante (modo legado)', () => {
    const nodes = [makeStart(), makeDelay({ unit: 'minutes' }), END]
    const result = validateFlow(nodes, [edgeNext])
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('duração'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-17b: duration=0 no novo modo → erro bloqueante (duration é obrigatória)', () => {
    const nodes = [makeStart(), makeDelay({ duration: 0, unit: 'minutes', wait_mode: 'time_or_response' }), END]
    const edges = [edgeResponded, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('duração'))).toBe(true)
    expect(result.isValid).toBe(false)
  })
})

// =============================================================================
// TC-18 a TC-20 — response_variable (campo opcional)
// =============================================================================

describe('response_variable — campo opcional', () => {
  it('TC-18: response_variable ausente → válido', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-19: response_variable=null → válido', () => {
    const nodes = [makeStart(), makeDelay({ ...TOR_CONFIG, response_variable: null }), END]
    const edges = [edgeResponded, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-20: response_variable="" → não bloqueia publicação', () => {
    const nodes = [makeStart(), makeDelay({ ...TOR_CONFIG, response_variable: '' }), END]
    const edges = [edgeResponded, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-20b: response_variable com nome válido → válido (sem validação de nome nesta etapa)', () => {
    const nodes = [makeStart(), makeDelay(TOR_WITH_VAR), END]
    const edges = [edgeResponded, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })
})

// =============================================================================
// TC-21 a TC-22 — Flow importado antigo / node duplicado sem edges
// =============================================================================

describe('Flow importado antigo e node duplicado', () => {
  it('TC-21: flow antigo sem wait_mode e edge sem sourceHandle → sem regressão', () => {
    const nodes = [makeStart(), makeDelay({ duration: 5, unit: 'minutes' }), END]
    const edgeAntiga = makeEdge('e-antigo', delayId, 'end-1')
    const result = validateFlow(nodes, [edgeAntiga])
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-22: delay time_or_response sem edges → inválido (faltam responded e timeout)', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const result = validateFlow(nodes, []) // sem edges de saída
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.length).toBeGreaterThanOrEqual(2)
    expect(delayErrors.some(e => e.message.includes('Lead respondeu'))).toBe(true)
    expect(delayErrors.some(e => e.message.includes('Sem resposta'))).toBe(true)
    expect(result.isValid).toBe(false)
  })
})

// =============================================================================
// TC-23 a TC-24 — Isolamento de edges (outro nó / edges de entrada)
// =============================================================================

describe('Isolamento de edges', () => {
  it('TC-23: edges de outro nó não contam para o delay', () => {
    const outroNode = makeNode('outro-1', 'action', { actionType: 'add_tag' }, 'Ação')
    const edgeOutro = makeEdge('e-outro', 'outro-1', 'end-1', 'responded')
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), outroNode, END]
    // delay-1 tem edges corretas; "outro-1" tem edge responded (não deve contaminar)
    const edges = [edgeResponded, edgeTimeout, edgeOutro]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })

  it('TC-24: edges de entrada no delay não contam como saída', () => {
    const prevNode = makeNode('prev-1', 'action', { actionType: 'add_tag' }, 'Anterior')
    const edgeIn = makeEdge('e-in', 'prev-1', delayId, 'responded')
    const nodes = [makeStart(), prevNode, makeDelay(TOR_CONFIG), END]
    // delay-1 recebe edge com handle responded (mas é entrada, não saída)
    const edges = [edgeIn, edgeResponded, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
  })
})

// =============================================================================
// TC-25 a TC-26 — isValid e warnings não bloqueantes
// =============================================================================

describe('isValid e warnings', () => {
  it('TC-25: erros de handle são bloqueantes (isValid=false)', () => {
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeTimeout] // sem responded
    const result = validateFlow(nodes, edges)
    expect(result.errors.some(e => e.type === 'error' && e.nodeId === delayId)).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-26: warnings existentes (ex: sem bloco end) continuam não bloqueantes', () => {
    // Flow válido em termos de delay, mas sem nó end → gera warning (não erro)
    const nodes = [makeStart(), makeDelay(TOR_CONFIG)]
    const edgeStartToDelay = makeEdge('e-s-d', 'start-1', delayId)
    const edges = [edgeStartToDelay, edgeResponded, edgeTimeout]
    const result = validateFlow(nodes, edges)
    // O flow pode ter warnings, mas se os erros forem apenas estruturais do setup,
    // o delay em si não adiciona erros
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors).toHaveLength(0)
    // Warnings não afetam isValid
    const hasNoEndWarning = result.warnings.some(w => w.message.includes('finalização'))
    expect(hasNoEndWarning).toBe(true)
  })
})

// =============================================================================
// TC-27 a TC-30 — Sem regressão em outros tipos de nó
// =============================================================================

describe('Sem regressão em outros tipos de nó', () => {
  it('TC-27: nó message sem messageType → erro (comportamento existente preservado)', () => {
    const msgNode = makeNode('msg-1', 'message', {}, 'Mensagem')
    const nodes = [makeStart(), msgNode, END]
    const result = validateFlow(nodes, [])
    const msgErrors = result.errors.filter(e => e.nodeId === 'msg-1')
    expect(msgErrors.length).toBeGreaterThan(0)
  })

  it('TC-28: condition nodes mantêm validações atuais (true/false como warnings)', () => {
    const condNode = makeNode('cond-1', 'condition', { type: 'lead_field', field: 'name' }, 'Condição')
    const nodes = [makeStart(), condNode, END]
    // Sem edges para true/false → warnings (não erros)
    const result = validateFlow(nodes, [])
    const condWarnings = result.warnings.filter(w => w.nodeId === 'cond-1')
    expect(condWarnings.length).toBeGreaterThan(0)
    // Condition sem handle não deve gerar ERRO (preserva comportamento atual)
    const condErrors = result.errors.filter(e => e.nodeId === 'cond-1')
    expect(condErrors).toHaveLength(0)
  })

  it('TC-29: tipos TypeScript aceitam os três formatos de DelayConfig', () => {
    // Verificação em tempo de compilação via assignments tipados.
    // Se houver erro de tipo, o tsc falha antes de rodar o teste.
    const legacyConfig: import('../../types/automation').DelayConfig = {
      duration: 15,
      unit: 'minutes',
    }
    const timeConfig: import('../../types/automation').DelayConfig = {
      duration: 15,
      unit: 'minutes',
      wait_mode: 'time',
    }
    const torConfig: import('../../types/automation').DelayConfig = {
      duration: 15,
      unit: 'minutes',
      wait_mode: 'time_or_response',
      response_variable: 'resposta_lead',
    }
    const torNull: import('../../types/automation').DelayConfig = {
      duration: 15,
      unit: 'minutes',
      wait_mode: 'time_or_response',
      response_variable: null,
    }
    // Se chegou aqui, os tipos são válidos
    expect(legacyConfig.duration).toBe(15)
    expect(timeConfig.wait_mode).toBe('time')
    expect(torConfig.wait_mode).toBe('time_or_response')
    expect(torNull.response_variable).toBeNull()
  })

  it('TC-30: nenhum campo existente de DelayConfig foi removido', () => {
    // O campo business_hours_only ainda deve existir
    const config: import('../../types/automation').DelayConfig = {
      duration: 30,
      unit: 'days',
      business_hours_only: true,
    }
    expect(config.business_hours_only).toBe(true)
  })
})

// =============================================================================
// TC-31 a TC-34 — Troca de modo (time_or_response → time)
// =============================================================================

describe('Troca de modo time_or_response → time', () => {
  it('TC-31: modo time com edge responded → erro bloqueante (incompatível com executor legado)', () => {
    // Usuário trocou de time_or_response para time, mas a edge responded permanece
    const nodes = [makeStart(), makeDelay({ ...TIME_CONFIG }), END]
    const edges = [edgeNext, edgeResponded]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('incompatíveis'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-32: modo time com edge timeout → erro bloqueante (incompatível com executor legado)', () => {
    const nodes = [makeStart(), makeDelay({ ...TIME_CONFIG }), END]
    const edges = [edgeNext, edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('incompatíveis'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-33: modo legado (sem wait_mode) com edge responded → erro bloqueante', () => {
    const nodes = [makeStart(), makeDelay(LEGACY_CONFIG), END]
    const edges = [edgeResponded]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('incompatíveis'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-34: modo legado (sem wait_mode) com edge timeout → erro bloqueante', () => {
    const nodes = [makeStart(), makeDelay(LEGACY_CONFIG), END]
    const edges = [edgeTimeout]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('incompatíveis'))).toBe(true)
    expect(result.isValid).toBe(false)
  })
})

// =============================================================================
// TC-35 a TC-36 — Três ou mais edges no novo modo
// =============================================================================

describe('Três ou mais edges no novo modo', () => {
  it('TC-35: responded + timeout + responded_extra → erros (duplicidade + não-bloqueio extra)', () => {
    const edgeResp2 = makeEdge('e-resp-2', delayId, 'end-1', 'responded')
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeTimeout, edgeResp2]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('mais de uma') && e.message.includes('respondeu'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-36: responded + timeout + timeout_extra → erros (duplicidade)', () => {
    const edgeTout2 = makeEdge('e-tout-2', delayId, 'end-1', 'timeout')
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeTimeout, edgeTout2]
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('mais de uma') && e.message.includes('timeout'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-36b: apenas responded duplicado (sem timeout) → múltiplos erros', () => {
    const edgeResp2 = makeEdge('e-resp-2', delayId, 'end-1', 'responded')
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeResponded, edgeResp2] // sem timeout
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    // Deve ter: faltou timeout + respondeu duplicado
    expect(delayErrors.some(e => e.message.includes('Sem resposta') || e.message.includes('timeout'))).toBe(true)
    expect(delayErrors.some(e => e.message.includes('mais de uma') && e.message.includes('respondeu'))).toBe(true)
    expect(result.isValid).toBe(false)
  })

  it('TC-36c: apenas timeout duplicado (sem responded) → múltiplos erros', () => {
    const edgeTout2 = makeEdge('e-tout-2', delayId, 'end-1', 'timeout')
    const nodes = [makeStart(), makeDelay(TOR_CONFIG), END]
    const edges = [edgeTimeout, edgeTout2] // sem responded
    const result = validateFlow(nodes, edges)
    const delayErrors = result.errors.filter(e => e.nodeId === delayId)
    expect(delayErrors.some(e => e.message.includes('Lead respondeu'))).toBe(true)
    expect(delayErrors.some(e => e.message.includes('mais de uma') && e.message.includes('timeout'))).toBe(true)
    expect(result.isValid).toBe(false)
  })
})
