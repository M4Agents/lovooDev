// =============================================================================
// eventDispatcher — despacha eventos para o handler correto
//
// Responsabilidade: SOMENTE roteamento por topic prefix.
// Nenhuma lógica de negócio aqui.
//
// Mapeamento:
//   customer/*   → customerHandler
//   order/*      → orderHandler (inclui packed/fulfilled)
//   product/*    → productHandler
//   category/*   → categoryHandler
//   checkout/*   → cartHandler
//   app/*        → appHandler
//   store/redact, customers/redact, customers/data_request → lgpdHandler
//
// Novos webhooks: adicionar nova entrada no DISPATCH_MAP — sem alterar o worker.
//
// Contrato dos handlers:
//   - Recebem ctx: { companyId, storeId, topic, payload, correlationId, workerId }
//   - Retornam { ok: true } em sucesso
//   - Lançam Error em falha
//   - NUNCA controlam lock, heartbeat ou claim
// =============================================================================

import { customerHandler }   from './handlers/customerHandler.js';
import { orderHandler }      from './handlers/orderHandler.js';
import { productHandler }    from './handlers/productHandler.js';
import { categoryHandler }   from './handlers/categoryHandler.js';
import { fulfillmentHandler }from './handlers/fulfillmentHandler.js';
import { checkoutHandler }   from './handlers/checkoutHandler.js';
import { lgpdHandler }       from './handlers/lgpdHandler.js';
import { appHandler }        from './handlers/appHandler.js';

// ── Mapa de topic → handler ────────────────────────────────────────────────

const DISPATCH_MAP = {
  // Clientes
  'customer/created': customerHandler,
  'customer/updated': customerHandler,
  'customer/deleted': customerHandler,

  // Pedidos
  'order/created':   orderHandler,
  'order/paid':      orderHandler,
  'order/cancelled': orderHandler,
  'order/updated':   orderHandler,

  // Fulfillment (separado por semântica — Fase 11)
  'order/packed':    fulfillmentHandler,
  'order/fulfilled': fulfillmentHandler,

  // Produtos
  'product/created': productHandler,
  'product/updated': productHandler,
  'product/deleted': productHandler,

  // Categorias
  'category/created': categoryHandler,
  'category/updated': categoryHandler,
  'category/deleted': categoryHandler,

  // Carrinhos abandonados (Fase 10)
  'checkout/abandoned': checkoutHandler,

  // App
  'app/uninstalled': appHandler,

  // LGPD / dados pessoais
  'store/redact':              lgpdHandler,
  'customers/redact':          lgpdHandler,
  'customers/data_request':    lgpdHandler,
};

/**
 * Despacha o evento ao handler correto com base no topic.
 *
 * @param {{ companyId: string, storeId: string, topic: string, payload: object, correlationId: string, workerId: string }} ctx
 * @returns {Promise<{ ok: boolean }>}
 * @throws {Error} Handler não encontrado ou handler lançou erro
 */
export async function dispatch(ctx) {
  const { topic } = ctx;
  const handlerFn = DISPATCH_MAP[topic];

  if (!handlerFn) {
    // Topic desconhecido — não tratar como erro crítico para não gerar retry
    // Logar e marcar como processed para não bloquear a fila
    console.warn('[eventDispatcher] unknown_topic topic=%s companyId=%s', topic, ctx.companyId);
    return { ok: true, skipped: true, reason: 'unknown_topic' };
  }

  return handlerFn(ctx);
}

/**
 * Extrai resource_type a partir do topic para aquisição de lock.
 * @param {string} topic
 * @returns {string}
 */
export function topicToResourceType(topic) {
  if (!topic) return 'unknown';

  // Fulfillment é tratado como 'order' para lock (mesmo recurso)
  if (topic === 'order/packed' || topic === 'order/fulfilled') return 'order';

  // LGPD events não precisam de lock por recurso (processamento independente)
  if (topic === 'store/redact') return 'store';
  if (topic.startsWith('customers/')) return 'customer';

  return topic.split('/')[0] ?? 'unknown';
}
