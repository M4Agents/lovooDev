// =============================================================================
// Testes unitários — updateOpportunity (crmActions.js)
//
// Framework: vitest
// Estratégia: mocks completos do supabase e contextUtils
//   - Sem conexão com banco real
//   - Sem chamadas de rede
//   - Testa exclusivamente a lógica de validação e orquestração
//
// Para executar: npm test
// =============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeCrmAction } from '../crmActions.js'

// ---------------------------------------------------------------------------
// Fábrica de mock supabase
// Por padrão: update ok (1 linha), rpc ok.
// ---------------------------------------------------------------------------
function makeSupa({ updateRow = { id: 'opp-uuid' }, updateError = null, rpcData = { success: true, items_processed: 1 }, rpcError = null } = {}) {
  const maybeSingleUpdate = vi.fn().mockResolvedValue({ data: updateRow, error: updateError })
  const selectUpdate      = vi.fn().mockReturnValue({ maybeSingle: maybeSingleUpdate })
  const eqUpdate2         = vi.fn().mockReturnValue({ select: selectUpdate })
  const eqUpdate1         = vi.fn().mockReturnValue({ eq: eqUpdate2 })
  const update            = vi.fn().mockReturnValue({ eq: eqUpdate1 })

  const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: rpcError })

  // oportunidades.select (resolveOpportunityId)
  const maybeSingleOpp = vi.fn().mockResolvedValue({ data: { id: 'opp-uuid' }, error: null })
  const limitOpp       = vi.fn().mockReturnValue({ maybeSingle: maybeSingleOpp })
  const orderOpp       = vi.fn().mockReturnValue({ limit: limitOpp })
  const notOpp         = vi.fn().mockReturnValue({ order: orderOpp })
  const eqOpp2         = vi.fn().mockReturnValue({ not: notOpp })
  const eqOpp1         = vi.fn().mockReturnValue({ eq: eqOpp2 })
  const selectOpp      = vi.fn().mockReturnValue({ eq: eqOpp1 })

  const from = vi.fn((table) => {
    if (table === 'opportunities') {
      return { select: selectOpp, update }
    }
    return { select: vi.fn(), update }
  })

  return { from, rpc, _mocks: { update, rpc, maybeSingleUpdate } }
}

// ---------------------------------------------------------------------------
// Context base
// ---------------------------------------------------------------------------
const baseContext = {
  executionId:  'exec-1',
  flowId:       'flow-1',
  companyId:    'company-uuid',
  leadId:       42,
  triggerData:  {},
  variables:    {},
}

// ---------------------------------------------------------------------------
// Nó base para update_opportunity
// ---------------------------------------------------------------------------
function makeNode(configOverride = {}) {
  return {
    id:   'node-1',
    type: 'action',
    data: {
      config: {
        actionType: 'update_opportunity',
        ...configOverride,
      },
    },
  }
}

// =============================================================================
// GRUPO 1 — Config vazia / skipped
// =============================================================================
describe('update_opportunity — config vazia', () => {
  it('retorna skipped quando config é completamente vazia', async () => {
    const supa = makeSupa()
    const node = makeNode({})
    const result = await executeCrmAction(node, baseContext, supa)
    expect(result.skipped).toBe(true)
  })

  it('retorna skipped quando fields vazio e manageItems false', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: {}, manageItems: false })
    const result = await executeCrmAction(node, baseContext, supa)
    expect(result.skipped).toBe(true)
  })

  it('retorna skipped quando manageItems não é exatamente true', async () => {
    const supa = makeSupa()
    const node = makeNode({ manageItems: 1, itemsMode: 'add', items: [] })
    const result = await executeCrmAction(node, baseContext, supa)
    expect(result.skipped).toBe(true)
  })
})

// =============================================================================
// GRUPO 2 — Oportunidade ausente
// =============================================================================
describe('update_opportunity — oportunidade ausente', () => {
  it('retorna skipped quando não há opportunityId no context nem lead com oportunidade', async () => {
    const supa = makeSupa()
    // Sobrescreve resolução pelo banco para retornar null
    const maybeSingleNull = vi.fn().mockResolvedValue({ data: null, error: null })
    const limitNull  = vi.fn().mockReturnValue({ maybeSingle: maybeSingleNull })
    const orderNull  = vi.fn().mockReturnValue({ limit: limitNull })
    const notNull    = vi.fn().mockReturnValue({ order: orderNull })
    const eq2Null    = vi.fn().mockReturnValue({ not: notNull })
    const eq1Null    = vi.fn().mockReturnValue({ eq: eq2Null })
    const selNull    = vi.fn().mockReturnValue({ eq: eq1Null })
    supa.from = vi.fn(() => ({ select: selNull, update: vi.fn() }))

    const ctx = { ...baseContext, leadId: null, opportunityId: null }
    const node = makeNode({ fields: { title: 'Teste' } })
    const result = await executeCrmAction(node, ctx, supa)
    expect(result.skipped).toBe(true)
  })
})

// =============================================================================
// GRUPO 3 — Validação de título
// =============================================================================
describe('update_opportunity — title', () => {
  it('aceita somente título válido', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: { title: 'Meu Título' } })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.updated).toBe(true)
    expect(result.fields).toContain('title')
  })

  it('rejeita título vazio', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: { title: '' } })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('title inválido')
  })

  it('rejeita título com somente espaços', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: { title: '   ' } })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('title inválido')
  })
})

// =============================================================================
// GRUPO 4 — Validação de descrição
// =============================================================================
describe('update_opportunity — description', () => {
  it('aceita string normal', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: { description: 'Descrição técnica' } })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.fields).toContain('description')
  })

  it('aceita string vazia', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: { description: '' } })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.fields).toContain('description')
  })

  it('aceita null', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: { description: null } })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.fields).toContain('description')
  })

  it('rejeita number como description', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: { description: 42 } })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('description inválido')
  })
})

// =============================================================================
// GRUPO 5 — Validação de probability
// =============================================================================
describe('update_opportunity — probability', () => {
  it.each([
    [0,   true],
    [50,  true],
    [100, true],
  ])('aceita probability=%s', async (prob, shouldPass) => {
    const supa = makeSupa()
    const node = makeNode({ fields: { probability: prob } })
    if (shouldPass) {
      const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
      expect(result.fields).toContain('probability')
    }
  })

  it.each([
    [50.5,     'decimal'],
    ['50abc',  'string inválida'],
    [NaN,      'NaN'],
    [Infinity, 'Infinity'],
    [-1,       'negativo'],
    [101,      'acima de 100'],
  ])('rejeita probability=%s (%s)', async (prob) => {
    const supa = makeSupa()
    const node = makeNode({ fields: { probability: prob } })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('probability inválido')
  })
})

// =============================================================================
// GRUPO 6 — Propriedade extra ignorada na whitelist
// =============================================================================
describe('update_opportunity — whitelist de campos', () => {
  it('ignora propriedade extra em fields (não envia para o banco)', async () => {
    const supa = makeSupa()
    const node = makeNode({ fields: { title: 'Ok', extraField: 'hacker' } })
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const result = await executeCrmAction(node, ctx, supa)
    // O update deve ter sido chamado sem extraField
    const updateCall = supa._mocks.update.mock.calls[0][0]
    expect(updateCall).not.toHaveProperty('extraField')
    expect(result.fields).not.toContain('extraField')
  })
})

// =============================================================================
// GRUPO 7 — Configuração de itens
// =============================================================================
describe('update_opportunity — configuração de itens', () => {
  it('rejeita itemsMode inválido', async () => {
    const supa = makeSupa()
    const node = makeNode({ manageItems: true, itemsMode: 'upsert', items: [] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('itemsMode inválido')
  })

  it('rejeita items não-array', async () => {
    const supa = makeSupa()
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: 'nao-array' })
    // items não-array é normalizado para [] → add + [] é skipped, não erro
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsSkipped).toBe(true)
  })

  it('item não-objeto lança erro', async () => {
    const supa = makeSupa()
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [42] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('item[0] inválido')
  })
})

// =============================================================================
// GRUPO 8 — Validação de itens individuais
// =============================================================================
describe('update_opportunity — itens individuais', () => {
  const baseItem = { productId: 'prod-uuid', quantity: 1, discountType: 'fixed', discountValue: 0 }

  it('aceita produto válido', async () => {
    const supa = makeSupa()
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [baseItem] })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsCount).toBe(1)
  })

  it('aceita serviço válido', async () => {
    const supa = makeSupa()
    const item = { serviceId: 'svc-uuid', quantity: 1, discountType: 'fixed', discountValue: 0 }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsCount).toBe(1)
  })

  it('rejeita produto + serviço juntos (XOR)', async () => {
    const supa = makeSupa()
    const item = { productId: 'p', serviceId: 's', quantity: 1, discountType: 'fixed', discountValue: 0 }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('exatamente um entre productId e serviceId')
  })

  it('rejeita nenhum entre produto e serviço', async () => {
    const supa = makeSupa()
    const item = { quantity: 1, discountType: 'fixed', discountValue: 0 }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('exatamente um entre productId e serviceId')
  })

  it.each([[0, 'zero'], [-1, 'negativo'], [NaN, 'NaN']])('rejeita quantity=%s (%s)', async (qty) => {
    const supa = makeSupa()
    const item = { ...baseItem, quantity: qty }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('quantity')
  })

  it('aceita unitPrice null (usa default do catálogo)', async () => {
    const supa = makeSupa()
    const item = { ...baseItem, unitPrice: null }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsCount).toBe(1)
  })

  it('aceita unitPrice zero', async () => {
    const supa = makeSupa()
    const item = { ...baseItem, unitPrice: 0 }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsCount).toBe(1)
  })

  it('rejeita unitPrice negativo', async () => {
    const supa = makeSupa()
    const item = { ...baseItem, unitPrice: -1 }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('unitPrice')
  })

  it('rejeita unitPrice Infinity', async () => {
    const supa = makeSupa()
    const item = { ...baseItem, unitPrice: Infinity }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('unitPrice')
  })

  it('aceita discountType fixed', async () => {
    const supa = makeSupa()
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [{ ...baseItem, discountType: 'fixed', discountValue: 10 }] })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsCount).toBe(1)
  })

  it('aceita discountType percent válido', async () => {
    const supa = makeSupa()
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [{ ...baseItem, discountType: 'percent', discountValue: 50 }] })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsCount).toBe(1)
  })

  it('rejeita discountType inválido (percentage em vez de percent)', async () => {
    const supa = makeSupa()
    const item = { ...baseItem, discountType: 'percentage', discountValue: 10 }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('discountType')
  })

  it('rejeita percent acima de 100', async () => {
    const supa = makeSupa()
    const item = { ...baseItem, discountType: 'percent', discountValue: 101 }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('100%')
  })

  it('rejeita discountValue negativo', async () => {
    const supa = makeSupa()
    const item = { ...baseItem, discountValue: -1 }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('discountValue')
  })

  it('rejeita discountValue NaN', async () => {
    const supa = makeSupa()
    const item = { ...baseItem, discountValue: NaN }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [item] })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('discountValue')
  })
})

// =============================================================================
// GRUPO 9 — Persistência e filtragem multi-tenant
// =============================================================================
describe('update_opportunity — persistência', () => {
  it('UPDATE filtra por opportunity id e company_id', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({ fields: { title: 'Novo Título' } })
    await executeCrmAction(node, ctx, supa)
    expect(supa._mocks.update).toHaveBeenCalledOnce()
  })

  it('zero linhas atualizadas lança erro', async () => {
    const supa = makeSupa({ updateRow: null })
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({ fields: { title: 'Título' } })
    await expect(executeCrmAction(node, ctx, supa))
      .rejects.toThrow('não encontrada ou não pertence à empresa')
  })

  it('erro no update impede chamada da RPC', async () => {
    const supa = makeSupa({ updateError: { message: 'DB error' }, updateRow: null })
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({
      fields: { title: 'Título' },
      manageItems: true,
      itemsMode: 'add',
      items: [{ productId: 'p', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    await expect(executeCrmAction(node, ctx, supa))
      .rejects.toThrow('erro ao atualizar campos')
    expect(supa._mocks.rpc).not.toHaveBeenCalled()
  })

  it('update bem-sucedido chama RPC', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({
      fields: { title: 'Título' },
      manageItems: true,
      itemsMode: 'replace',
      items: [{ productId: 'p', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    await executeCrmAction(node, ctx, supa)
    expect(supa._mocks.rpc).toHaveBeenCalledWith('automation_manage_opportunity_items_v1', expect.objectContaining({
      p_company_id:     'company-uuid',
      p_opportunity_id: 'opp-uuid',
      p_items_mode:     'replace',
    }))
  })

  it('erro da RPC propaga falha e não silencia', async () => {
    const supa = makeSupa({ rpcError: { message: 'OPP_CATALOG_NOT_FOUND' } })
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({
      manageItems: true,
      itemsMode: 'add',
      items: [{ productId: 'p', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    await expect(executeCrmAction(node, ctx, supa))
      .rejects.toThrow('RPC de itens falhou')
  })

  it('retorno estruturado correto com campos e itens', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({
      fields: { title: 'Título', probability: 80 },
      manageItems: true,
      itemsMode: 'add',
      items: [{ productId: 'p', quantity: 2, discountType: 'fixed', discountValue: 0 }],
    })
    const result = await executeCrmAction(node, ctx, supa)
    expect(result.updated).toBe(true)
    expect(result.opportunityId).toBe('opp-uuid')
    expect(result.fields).toEqual(expect.arrayContaining(['title', 'probability']))
    expect(result.itemsMode).toBe('add')
    expect(result.itemsCount).toBe(1)
  })
})

// =============================================================================
// GRUPO 10 — opportunityResolution
// =============================================================================
describe('update_opportunity — opportunityResolution', () => {
  it('opportunityResolution = context quando opportunityId está no context', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({ fields: { title: 'T' } })
    const result = await executeCrmAction(node, ctx, supa)
    expect(result.opportunityResolution).toBe('context')
  })

  it('opportunityResolution = latest_open_by_lead quando resolve pelo banco', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: null, leadId: 42 }
    const node = makeNode({ fields: { title: 'T' } })
    const result = await executeCrmAction(node, ctx, supa)
    expect(result.opportunityResolution).toBe('latest_open_by_lead')
  })
})

// =============================================================================
// GRUPO 11 — add + [] skipped
// =============================================================================
describe('update_opportunity — add + [] skipped', () => {
  it('modo add com lista vazia retorna itemsSkipped = true', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({ manageItems: true, itemsMode: 'add', items: [] })
    const result = await executeCrmAction(node, ctx, supa)
    expect(result.itemsSkipped).toBe(true)
    expect(supa._mocks.rpc).not.toHaveBeenCalled()
  })
})

// =============================================================================
// GRUPO 12 — parâmetros exatos da RPC
// =============================================================================
describe('update_opportunity — parâmetros exatos da RPC', () => {
  it('envia p_items com productId/serviceId/quantity/unitPrice/discountType/discountValue corretos', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({
      manageItems: true,
      itemsMode:   'add',
      items: [{
        productId:     'prod-uuid-123',
        quantity:      3,
        unitPrice:     99.99,
        discountType:  'percent',
        discountValue: 10,
      }],
    })
    await executeCrmAction(node, ctx, supa)
    expect(supa._mocks.rpc).toHaveBeenCalledWith(
      'automation_manage_opportunity_items_v1',
      {
        p_company_id:     'company-uuid',
        p_opportunity_id: 'opp-uuid',
        p_items_mode:     'add',
        p_items: [{
          productId:     'prod-uuid-123',
          serviceId:     null,
          quantity:      3,
          unitPrice:     99.99,
          discountType:  'percent',
          discountValue: 10,
        }],
      }
    )
  })

  it('envia unitPrice = null quando ausente no item (usa preço do catálogo)', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({
      manageItems: true,
      itemsMode:   'add',
      items: [{ productId: 'prod-uuid', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    await executeCrmAction(node, ctx, supa)
    const rpcCall = supa._mocks.rpc.mock.calls[0][1]
    expect(rpcCall.p_items[0].unitPrice).toBeNull()
  })

  it('converte serviceId corretamente e seta productId = null na RPC', async () => {
    const supa = makeSupa()
    const ctx  = { ...baseContext, opportunityId: 'opp-uuid' }
    const node = makeNode({
      manageItems: true,
      itemsMode:   'replace',
      items: [{ serviceId: 'svc-uuid-456', quantity: 2, discountType: 'fixed', discountValue: 0 }],
    })
    await executeCrmAction(node, ctx, supa)
    const rpcCall = supa._mocks.rpc.mock.calls[0][1]
    expect(rpcCall.p_items[0].productId).toBeNull()
    expect(rpcCall.p_items[0].serviceId).toBe('svc-uuid-456')
  })
})

// =============================================================================
// GRUPO 13 — estado transitório dos botões Produto/Serviço (XOR do backend)
//
// Quando o usuário clica "Produto" sem selecionar item no catálogo,
// productId fica como string vazia. O backend deve rejeitar.
// =============================================================================
describe('update_opportunity — productId/serviceId vazio (estado transitório de UI)', () => {
  it('rejeita productId vazio (string vazia — clique no botão sem seleção)', async () => {
    const supa = makeSupa()
    const node = makeNode({
      manageItems: true,
      itemsMode: 'add',
      items: [{ productId: '', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('exatamente um entre productId e serviceId')
  })

  it('rejeita serviceId vazio (string vazia — clique no botão sem seleção)', async () => {
    const supa = makeSupa()
    const node = makeNode({
      manageItems: true,
      itemsMode: 'add',
      items: [{ serviceId: '', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    await expect(executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa))
      .rejects.toThrow('exatamente um entre productId e serviceId')
  })

  it('item com productId vazio não alcança a RPC', async () => {
    const supa = makeSupa()
    const node = makeNode({
      manageItems: true,
      itemsMode: 'add',
      items: [{ productId: '', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    try { await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa) } catch {}
    expect(supa._mocks.rpc).not.toHaveBeenCalled()
  })

  it('alternância Produto→Serviço: serviceId definido e productId undefined', async () => {
    // Simula config resultante após clique em "Serviço" com item previamente em modo produto
    // Estado: { productId: undefined, serviceId: 'svc-uuid' }
    const supa = makeSupa()
    const node = makeNode({
      manageItems: true,
      itemsMode: 'add',
      items: [{ productId: undefined, serviceId: 'svc-uuid', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsCount).toBe(1)
    const rpcCall = supa._mocks.rpc.mock.calls[0][1]
    expect(rpcCall.p_items[0].productId).toBeNull()
    expect(rpcCall.p_items[0].serviceId).toBe('svc-uuid')
  })

  it('alternância Serviço→Produto: productId definido e serviceId undefined', async () => {
    // Simula config resultante após clique em "Produto" com item previamente em modo serviço
    const supa = makeSupa()
    const node = makeNode({
      manageItems: true,
      itemsMode: 'add',
      items: [{ productId: 'prod-uuid', serviceId: undefined, quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })
    const result = await executeCrmAction(node, { ...baseContext, opportunityId: 'opp-uuid' }, supa)
    expect(result.itemsCount).toBe(1)
    const rpcCall = supa._mocks.rpc.mock.calls[0][1]
    expect(rpcCall.p_items[0].serviceId).toBeNull()
    expect(rpcCall.p_items[0].productId).toBe('prod-uuid')
  })
})

// =============================================================================
// GRUPO 14 — logs sem dados sensíveis
// =============================================================================
describe('update_opportunity — logs sem dados sensíveis', () => {
  it('log de falha da RPC não contém título, descrição ou payload de itens', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supa   = makeSupa({ rpcError: { message: 'OPP_CATALOG_NOT_FOUND' } })
    const ctx    = { ...baseContext, opportunityId: 'opp-uuid' }
    const node   = makeNode({
      fields: { title: 'Título Secreto', description: 'Desc secreta' },
      manageItems: true,
      itemsMode: 'add',
      items: [{ productId: 'prod-uuid', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    })

    try { await executeCrmAction(node, ctx, supa) } catch { /* esperado */ }

    const logArgs = JSON.stringify(logSpy.mock.calls)
    expect(logArgs).not.toContain('Título Secreto')
    expect(logArgs).not.toContain('Desc secreta')
    expect(logArgs).not.toContain('prod-uuid')
    logSpy.mockRestore()
  })
})
