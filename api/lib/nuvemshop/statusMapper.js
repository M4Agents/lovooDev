// =============================================================================
// statusMapper — Fonte única de conversão de status Nuvemshop → CRM
//
// ── Contrato (Plano v5.1) ─────────────────────────────────────────────────────
//
// Este módulo é uma FUNÇÃO PURA.
//
//   - Sem acesso ao banco de dados.
//   - Sem chamadas de rede.
//   - Sem side effects de qualquer natureza.
//   - Retorna sempre o mesmo resultado para os mesmos inputs.
//   - Totalmente reutilizável por:
//       • Webhook handlers (processamento em tempo real)
//       • Replay administrativo (reprocessamento de eventos)
//       • Reconciliação (sync periódico via API Nuvemshop)
//       • Sync manual (ação do operador no painel)
//
//   - Nenhum handler, sync ou worker pode converter status manualmente.
//     Todo mapeamento de status passa obrigatoriamente por este módulo.
//
//   - Status bruto da API (raw) é preservado pelo chamador para auditoria.
//     Este módulo não persiste nada.
//
// ── value_mode = 'manual' ────────────────────────────────────────────────────
//
// `extractSafePaymentData` neste módulo é usada exclusivamente junto a
// `value_mode = 'manual'` nas oportunidades criadas pela integração Nuvemshop.
//
// O valor financeiro oficial da oportunidade é SEMPRE o informado pela
// Nuvemshop (order.total). Ele NUNCA deve ser recalculado automaticamente
// pelo CRM a partir dos itens da oportunidade (opportunity_items).
//
// Motivo: os itens podem estar incompletos — produtos ainda não sincronizados
// são omitidos de opportunity_items, e o total dos itens persistidos seria
// menor que o real. O campo `value` em opportunities deve sempre refletir
// o total exato do pedido, independente de quantos itens foram resolvidos.
//
// ── Lifecycle de pedidos Nuvemshop ────────────────────────────────────────────
//
//   order.status:        open | closed | cancelled
//   payment_status:      pending | authorized | paid | voided |
//                        refunded | abandoned | partially_refunded
//   fulfillment_status:  unfulfilled | partial | fulfilled
//
// ── Mapeamento para status CRM (opportunities) ────────────────────────────────
//
//   Topic overrides (maior prioridade):
//     order/paid      → 'won'   (pagamento confirmado = venda concluída)
//     order/fulfilled → 'won'   (entrega concluída = ciclo de venda encerrado)
//
//   Por order.status (quando não há topic override):
//     'closed'    → 'won'
//     'cancelled' → 'lost'
//     'open'      → 'open'
//     outros      → 'open'   (safe default)
//
//   order/packed: sem override de status — o CRM mantém o status atual
//   derivado de order.status. O packed é registrado apenas na timeline.
//
//   Nota: order/paid e order/fulfilled podem chegar antes de order.status
//   mudar para 'closed'. Os overrides garantem atualização imediata no CRM.
// =============================================================================

// ── Mapeamento de status de pedido → status CRM ───────────────────────────────

/** @type {Record<string, 'open'|'won'|'lost'>} */
const ORDER_STATUS_CRM = {
  open:      'open',
  closed:    'won',
  cancelled: 'lost',
};

/** @type {Record<string, 'open'|'won'|'lost'>} */
const PAYMENT_STATUS_CRM = {
  pending:              'open',
  authorized:           'open',
  paid:                 'won',
  voided:               'lost',
  refunded:             'lost',
  abandoned:            'lost',
  partially_refunded:   'open',
};

// ── Mapeamento de fulfillment (para futuro uso — Fase 10+) ────────────────────

/** @type {Record<string, string>} */
const FULFILLMENT_STATUS_CRM = {
  fulfilled:   'fulfilled',
  unfulfilled: 'pending',
  partial:     'partial',
};

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Converte status do pedido Nuvemshop → status de oportunidade CRM.
 *
 * O topic tem prioridade máxima: `order/paid` retorna 'won' imediatamente,
 * sem aguardar o order.status mudar para 'closed'.
 *
 * @param {{
 *   topic:          string,          // ex: 'order/created', 'order/paid', 'order/updated'
 *   orderStatus:    string,          // order.status da API
 *   paymentStatus?: string|null      // order.payment_status da API (opcional)
 * }} params
 * @returns {'open'|'won'|'lost'}
 */
export function mapOrderStatusToCrm({ topic, orderStatus, paymentStatus }) {
  // Topic overrides: eventos com semântica positiva definitiva
  if (topic === 'order/paid')      return 'won';
  if (topic === 'order/fulfilled') return 'won';  // Entrega = ciclo concluído

  // order/packed: sem override — status deriva de order.status (geralmente 'open')
  // O packed é registrado na timeline mas não altera o status da oportunidade

  // Mapeamento por order.status
  const fromOrder = ORDER_STATUS_CRM[orderStatus];
  if (fromOrder) return fromOrder;

  // Fallback conservador
  return 'open';
}

/**
 * Retorna o status CRM isolado do payment_status.
 * Útil para diagnóstico e log.
 *
 * @param {string} paymentStatus
 * @returns {'open'|'won'|'lost'}
 */
export function mapPaymentStatusToCrm(paymentStatus) {
  return PAYMENT_STATUS_CRM[paymentStatus] ?? 'open';
}

/**
 * Retorna o status interno de fulfillment para uso em campos e logs.
 *
 * @param {string} fulfillmentStatus  Status bruto da Nuvemshop
 * @returns {string}
 */
export function mapFulfillmentStatusToCrm(fulfillmentStatus) {
  return FULFILLMENT_STATUS_CRM[fulfillmentStatus] ?? 'pending';
}

/**
 * Retorna o label do evento de timeline para um topic de fulfillment.
 * Utilizado por fulfillmentSync para descrever o evento na timeline.
 *
 * @param {string} topic  ex: 'order/packed', 'order/fulfilled'
 * @returns {{ eventType: string, label: string }}
 */
export function mapFulfillmentTopicToTimeline(topic) {
  const MAP = {
    'order/packed':    { eventType: 'order_packed',    label: 'Pedido embalado'  },
    'order/fulfilled': { eventType: 'order_fulfilled', label: 'Pedido enviado'   },
  };
  return MAP[topic] ?? { eventType: topic.replace('/', '_'), label: topic };
}

/**
 * Extrai campos não-sensíveis de uma transação Nuvemshop.
 *
 * NUNCA incluir: número completo do cartão, CVV, tokens, credenciais.
 *
 * @param {object} transaction  Objeto de transação retornado pela API
 * @returns {object}
 */
export function extractSafePaymentData(transaction) {
  if (!transaction) return null;

  return {
    payment_method:           transaction.payment_method        ?? null,
    payment_provider_name:    transaction.payment_provider_name ?? null,
    payment_status:           transaction.status                ?? null,
    installments:             transaction.installments           ?? null,
    amount:                   transaction.amount != null
                                ? Number(transaction.amount)
                                : null,
    // Dados parciais do cartão (BIN + últimos dígitos) — nunca o número completo
    first_digits:             transaction.first_digits           ?? null,
    last_digits:              transaction.last_digits            ?? null,
    brand:                    transaction.card_brand
                              ?? transaction.payment_details?.brand
                              ?? null,
    // REMOVIDO: card_number, cvv, token, authorization, gateway_credentials
  };
}

/**
 * Dado o status CRM de uma oportunidade, retorna se ela deve ser fechada.
 *
 * @param {'open'|'won'|'lost'} crmStatus
 * @returns {boolean}
 */
export function isClosed(crmStatus) {
  return crmStatus === 'won' || crmStatus === 'lost';
}
