// =============================================================================
// Elegibilidade pelo histórico já sincronizado no Lovoo.
//
// Compra paga: inelegível.
// Nenhum pedido Nuvemshop: elegível com verificação limitada.
// Pedido cujo pagamento local não fecha o status real: inconclusivo.
// Falha de leitura: indisponível. Ausência não é concluída por erro.
// Reembolso total ou parcial: sem concessão, regra ainda pendente.
// status won, sozinho, não prova pagamento nem torna o caso elegível.
// =============================================================================

const REFUND_STATUSES = new Set(['refunded', 'partially_refunded']);

export const LIMITED_VERIFICATION_NOTE =
  'Nenhuma compra paga foi encontrada no histórico sincronizado. Pedidos ainda não sincronizados podem não aparecer. Isso não comprova primeira compra.';

export const PAYMENT_INCONCLUSIVE_NOTE =
  'Há pedido sincronizado, mas o status de pagamento local não permite concluir se ele foi pago. Isso não é tratado como ausência de compra.';

export function paymentStatusOf(opportunity) {
  const data = opportunity?.nuvemshop_payment_data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const status = data.payment_status;
  if (typeof status !== 'string') return null;
  const normalized = status.trim().toLowerCase();
  return normalized || null;
}

export function evaluateSyncedPurchases(opportunities) {
  const rows = opportunities ?? [];
  if (rows.length === 0) {
    return { eligibility: 'eligible_limited', limitation: LIMITED_VERIFICATION_NOTE };
  }
  const statuses = rows.map(paymentStatusOf);
  if (statuses.includes('paid')) {
    return { eligibility: 'ineligible_paid', limitation: null };
  }
  if (statuses.some((status) => REFUND_STATUSES.has(status))) {
    return { eligibility: 'pending_refund_rule', limitation: null };
  }
  return { eligibility: 'payment_inconclusive', limitation: PAYMENT_INCONCLUSIVE_NOTE };
}

export function classifyIdentity(phoneIds, emailIds) {
  const phones = uniqueIds(phoneIds);
  const emails = uniqueIds(emailIds);
  if (phones.length > 1 || emails.length > 1) return { identity: 'conflict', leadId: null };
  if (phones[0] != null && emails[0] != null && String(phones[0]) !== String(emails[0])) {
    return { identity: 'conflict', leadId: null };
  }
  const leadId = phones[0] ?? emails[0] ?? null;
  if (leadId == null) return { identity: 'none', leadId: null };
  return { identity: 'reuse', leadId };
}

function uniqueIds(values) {
  const seen = [];
  for (const value of values ?? []) {
    if (value == null) continue;
    if (!seen.some((item) => String(item) === String(value))) seen.push(value);
  }
  return seen;
}
