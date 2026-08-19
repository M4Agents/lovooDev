// =============================================================================
// Teste de integração do executor — updateOpportunity (E1–E7)
//
// AVISO: este script se conecta ao banco COMPARTILHADO (Dev+Prod) usando
//        service_role. Execute apenas em tenant técnico aprovado.
//
// Execução obrigatória:
//   RUN_AUTOMATION_INTEGRATION_TESTS=true \
//   SUPABASE_URL=<url> \
//   SUPABASE_SERVICE_ROLE_KEY=<key> \
//   TEST_COMPANY_ID=<uuid> \
//   TEST_OPPORTUNITY_ID=<uuid> \
//   TEST_PRODUCT_ID=<uuid> \
//   TEST_SERVICE_ID=<uuid> \
//   node api/lib/automation/__tests__/integration-executor.mjs
//
// Este script NÃO é executado por `vitest run` nem por `npm test`.
// Inclua apenas quando necessário para re-validação manual.
// =============================================================================

// ---------------------------------------------------------------------------
// Guard explícito — aborta sem a variável de controle
// ---------------------------------------------------------------------------
if (process.env.RUN_AUTOMATION_INTEGRATION_TESTS !== 'true') {
  console.error(
    '\n[integração] ERRO: execução não autorizada.\n' +
    'Defina RUN_AUTOMATION_INTEGRATION_TESTS=true para executar este script.\n'
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Validar variáveis de ambiente obrigatórias
// ---------------------------------------------------------------------------
const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TEST_COMPANY_ID',
  'TEST_OPPORTUNITY_ID',
  'TEST_PRODUCT_ID',
  'TEST_SERVICE_ID',
]

const missing = REQUIRED_VARS.filter(v => !process.env[v])
if (missing.length > 0) {
  console.error('\n[integração] Variáveis obrigatórias ausentes:', missing.join(', '))
  process.exit(1)
}

const SUPABASE_URL    = process.env.SUPABASE_URL
const COMPANY_ID      = process.env.TEST_COMPANY_ID
const OPPORTUNITY_ID  = process.env.TEST_OPPORTUNITY_ID
const PRODUCT_ID      = process.env.TEST_PRODUCT_ID
const SERVICE_ID      = process.env.TEST_SERVICE_ID

// ---------------------------------------------------------------------------
// Aviso de banco compartilhado — obrigatório antes de prosseguir
// ---------------------------------------------------------------------------
console.warn('\n⚠️  AVISO: Este script acessa o banco COMPARTILHADO (Dev+Prod).')
console.warn(`   Tenant: ${COMPANY_ID}`)
console.warn(`   Oportunidade: ${OPPORTUNITY_ID}`)
console.warn('   Todas as operações serão restauradas ao final.\n')

import { createClient } from '@supabase/supabase-js'
import { executeCrmAction } from '../crmActions.js'

const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ---------------------------------------------------------------------------
// Registro de falhas — exit code != 0 em qualquer falha
// ---------------------------------------------------------------------------
const failures = []

function assert(condition, message) {
  if (!condition) {
    failures.push(message)
    console.error(`  ❌ FALHOU: ${message}`)
  } else {
    console.log(`  ✅ OK: ${message}`)
  }
}

// ---------------------------------------------------------------------------
// Helpers de snapshot
// ---------------------------------------------------------------------------
async function snapshot(label) {
  const { data: opp } = await supabase
    .from('opportunities')
    .select('title, probability, value, items_subtotal, value_mode')
    .eq('id', OPPORTUNITY_ID)
    .eq('company_id', COMPANY_ID)
    .maybeSingle()

  const { data: items } = await supabase
    .from('opportunity_items')
    .select('id, line_type, unit_price, quantity, line_total')
    .eq('opportunity_id', OPPORTUNITY_ID)
    .eq('company_id', COMPANY_ID)
    .order('created_at')

  console.log(`\n📸 [${label}] title=${opp?.title} prob=${opp?.probability} value=${opp?.value} items=${items?.length}`)
  return { opp, items }
}

async function run(label, node, context) {
  console.log(`\n▶ ${label}`)
  try {
    const result = await executeCrmAction(node, context, supabase)
    const summary = result.skipped ? `skipped: ${result.reason}` : `updated=${result.updated} fields=${JSON.stringify(result.fields)} itemsCount=${result.itemsCount}`
    console.log(`  resultado: ${summary}`)
    return { ok: true, result }
  } catch (err) {
    console.log(`  erro: ${err.message}`)
    return { ok: false, error: err.message }
  }
}

function makeCtx(extra = {}) {
  return {
    executionId:   'integration-test',
    flowId:        'test-flow',
    companyId:     COMPANY_ID,
    variables:     {},
    triggerData:   {},
    opportunityId: OPPORTUNITY_ID,
    ...extra,
  }
}

function makeNode(config) {
  return { id: 'node-test', type: 'action', data: { config: { actionType: 'update_opportunity', ...config } } }
}

// ---------------------------------------------------------------------------
// Main com finally para restauração garantida
// ---------------------------------------------------------------------------
async function main() {
  console.log('\n══════════════════════════════════════════')
  console.log(' INTEGRAÇÃO: update_opportunity — E1 a E7')
  console.log('══════════════════════════════════════════')

  const { opp: initialOpp } = await snapshot('INICIAL')
  if (!initialOpp) throw new Error('Oportunidade técnica não encontrada — abortando')

  const originalTitle       = initialOpp.title
  const originalProbability = initialOpp.probability

  try {
    // E1 — somente título
    const e1 = await run('E1: atualizar somente título', makeNode({
      fields: { title: '[TEST-E1] Título Técnico' },
    }), makeCtx())
    const { opp: opp1 } = await snapshot('após E1')
    assert(e1.ok, 'E1: executeCrmAction não lançou erro')
    assert(opp1?.title === '[TEST-E1] Título Técnico', 'E1: título atualizado')
    await supabase.from('opportunities')
      .update({ title: originalTitle, updated_at: new Date().toISOString() })
      .eq('id', OPPORTUNITY_ID).eq('company_id', COMPANY_ID)

    // E2 — probability
    const e2 = await run('E2: atualizar probability', makeNode({
      fields: { probability: 75 },
    }), makeCtx())
    const { opp: opp2 } = await snapshot('após E2')
    assert(e2.ok, 'E2: executeCrmAction não lançou erro')
    assert(opp2?.probability === 75, 'E2: probability atualizada')
    await supabase.from('opportunities')
      .update({ probability: originalProbability, updated_at: new Date().toISOString() })
      .eq('id', OPPORTUNITY_ID).eq('company_id', COMPANY_ID)

    // E3 — add item técnico
    const e3 = await run('E3: add produto técnico', makeNode({
      manageItems: true, itemsMode: 'add',
      items: [{ productId: PRODUCT_ID, quantity: 1, discountType: 'fixed', discountValue: 0 }],
    }), makeCtx())
    const { items: items3 } = await snapshot('após E3')
    assert(e3.ok, 'E3: executeCrmAction não lançou erro')
    assert(items3?.length === 1, `E3: 1 item adicionado (encontrados: ${items3?.length})`)

    // E4 — replace com []
    const e4 = await run('E4: replace + []', makeNode({
      manageItems: true, itemsMode: 'replace', items: [],
    }), makeCtx())
    const { items: items4, opp: opp4 } = await snapshot('após E4')
    assert(e4.ok, 'E4: executeCrmAction não lançou erro')
    assert(items4?.length === 0, `E4: 0 itens após replace (encontrados: ${items4?.length})`)
    assert(Number(opp4?.value) === 0, 'E4: totais zerados após replace + []')

    // E5 — campos + itens
    const e5 = await run('E5: campos + itens', makeNode({
      fields: { title: '[TEST-E5] Completo', probability: 90 },
      manageItems: true, itemsMode: 'replace',
      items: [
        { productId: PRODUCT_ID, quantity: 2, unitPrice: 150, discountType: 'fixed',   discountValue: 0  },
        { serviceId: SERVICE_ID, quantity: 1,                 discountType: 'percent',  discountValue: 10 },
      ],
    }), makeCtx())
    const { opp: opp5, items: items5 } = await snapshot('após E5')
    assert(e5.ok, 'E5: executeCrmAction não lançou erro')
    assert(opp5?.title === '[TEST-E5] Completo', 'E5: título correto')
    assert(opp5?.probability === 90, 'E5: probability correta')
    assert(items5?.length === 2, `E5: 2 itens (encontrados: ${items5?.length})`)

    // E6 — falha da RPC após update de campo (risco residual documentado)
    const e6 = await run('E6: campo válido + item UUID inexistente', makeNode({
      fields: { title: '[TEST-E6] Falha nos itens' },
      manageItems: true, itemsMode: 'add',
      items: [{ productId: '00000000-0000-0000-0000-000000000099', quantity: 1, discountType: 'fixed', discountValue: 0 }],
    }), makeCtx())
    const { opp: opp6 } = await snapshot('após E6')
    assert(!e6.ok, 'E6: deve falhar (RPC rejeita UUID inválido)')
    assert(opp6?.title === '[TEST-E6] Falha nos itens', 'E6: campo atualizado mesmo com falha (risco residual confirmado)')

    // E7 — oportunidade ausente
    const e7 = await run('E7: oportunidade ausente', makeNode({
      fields: { title: 'Não deve ser salvo' },
    }), makeCtx({ opportunityId: null, leadId: null }))
    assert(e7.ok && e7.result?.skipped === true, 'E7: retorna skipped quando opportunityId ausente')

  } finally {
    // Restauração garantida — sempre executada, inclusive em caso de falha
    console.log('\n🔧 Restaurando estado inicial...')
    await supabase.from('opportunities')
      .update({ title: originalTitle, probability: originalProbability, updated_at: new Date().toISOString() })
      .eq('id', OPPORTUNITY_ID).eq('company_id', COMPANY_ID)

    await executeCrmAction(makeNode({ manageItems: true, itemsMode: 'replace', items: [] }), makeCtx(), supabase)
    const { opp: final } = await snapshot('FINAL (após restauração)')
    assert(final?.title === originalTitle, 'Restauração: título original')
    assert(Number(final?.value) === 0, 'Restauração: value zerado')
    console.log('\n══════════════════════════════════════════')
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} asserção(ões) falharam:`, failures)
    process.exit(1)
  }

  console.log(`\n✅ Integração concluída: todos os cenários passaram.\n`)
}

main().catch(err => {
  console.error('[integração] Erro fatal:', err.message)
  process.exit(1)
})
