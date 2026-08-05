// =============================================================================
// webhookSync — Registro e remoção de webhooks na API Nuvemshop
//
// Responsabilidades:
//   - registerWebhooks: cria todos os tópicos suportados na loja conectada
//   - deleteWebhooks:   remove os webhooks registrados (desconexão)
//
// Comportamento:
//   - Idempotente: verifica webhooks já existentes antes de criar
//   - Resiliente: falha parcial não cancela o restante
//   - Multi-tenant: cada empresa tem seu próprio conjunto de webhooks
//
// Segurança:
//   - Chamado apenas pelo backend (callback + disconnect + admin)
//   - Nunca exposto ao frontend
//   - Token descriptografado apenas em memória
// =============================================================================

import { createNuvemshopClient }    from './nuvemshopClient.js';
import { decryptNuvemshopToken }    from './tokenCrypto.js';

/** URL do receiver de webhooks do LoovooCRM */
const WEBHOOK_URL = (process.env.APP_BASE_URL ?? 'https://app.lovoocrm.com').replace(/\/$/, '')
  + '/api/nuvemshop/webhook';

/**
 * Tópicos suportados pelo eventDispatcher.
 * Somente estes são registrados na Nuvemshop.
 */
const SUPPORTED_TOPICS = [
  'product/created',
  'product/updated',
  'product/deleted',
  'category/created',
  'category/updated',
  'category/deleted',
  'customer/created',
  'customer/updated',
  'order/created',
  'order/paid',
  'order/cancelled',
  'order/updated',
  'order/packed',
  'order/fulfilled',
  // NOTA: 'checkout/abandoned' não existe como webhook na API Nuvemshop.
  // Carrinhos abandonados são detectados via polling GET /checkouts
  // no cron nuvemshop-reconcile (sync_type='checkouts').
  'app/uninstalled',
  'store/redact',
  'customers/redact',
  'customers/data_request',
];

/**
 * Registra todos os webhooks suportados na loja Nuvemshop.
 *
 * @param {{ nuvemshop_store_id: string, access_token_enc: string }} conn
 * @param {string} correlationId
 * @returns {Promise<{ registered: string[], skipped: string[], failed: string[], webhookIds: object[] }>}
 */
export async function registerWebhooks(conn, correlationId = 'manual') {
  const storeId     = conn.nuvemshop_store_id;
  const accessToken = decryptNuvemshopToken(conn.access_token_enc);

  const client = createNuvemshopClient({ storeId, accessToken, correlationId });

  // ── Buscar webhooks já existentes (idempotência) ───────────────────────────
  let existing = [];
  try {
    existing = await client.get('webhooks') ?? [];
  } catch (err) {
    console.warn('[webhookSync] list_failed storeId=%s err=%s', storeId, err?.message);
  }

  const existingByTopic = new Map(existing.map(wh => [wh.event, wh.id]));

  const registered = [];
  const skipped    = [];
  const failed     = [];
  const webhookIds = [...existing.map(wh => ({ id: wh.id, event: wh.event }))];

  // ── Registrar tópicos ausentes ─────────────────────────────────────────────
  for (const topic of SUPPORTED_TOPICS) {
    if (existingByTopic.has(topic)) {
      skipped.push(topic);
      continue;
    }

    try {
      const created = await client.post('webhooks', { event: topic, url: WEBHOOK_URL });
      registered.push(topic);
      webhookIds.push({ id: created.id, event: topic });
      console.log('[webhookSync] registered topic=%s id=%s storeId=%s', topic, created.id, storeId);
    } catch (err) {
      failed.push(topic);
      console.error('[webhookSync] register_failed topic=%s storeId=%s err=%s',
        topic, storeId, err?.message);
    }
  }

  console.log('[webhookSync] done storeId=%s registered=%d skipped=%d failed=%d',
    storeId, registered.length, skipped.length, failed.length);

  return { registered, skipped, failed, webhookIds };
}

/**
 * Remove os webhooks registrados na loja Nuvemshop.
 * Chamado durante a desconexão.
 *
 * @param {{ nuvemshop_store_id: string, access_token_enc: string, webhook_ids: object[] }} conn
 * @param {string} correlationId
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
export async function deleteWebhooks(conn, correlationId = 'manual') {
  const storeId     = conn.nuvemshop_store_id;
  const webhookIds  = conn.webhook_ids ?? [];

  if (!webhookIds.length) {
    console.log('[webhookSync] no_webhooks_to_delete storeId=%s', storeId);
    return { deleted: 0, failed: 0 };
  }

  let accessToken;
  try {
    accessToken = decryptNuvemshopToken(conn.access_token_enc);
  } catch (err) {
    console.warn('[webhookSync] decrypt_failed storeId=%s err=%s', storeId, err?.message);
    return { deleted: 0, failed: webhookIds.length };
  }

  const client = createNuvemshopClient({ storeId, accessToken, correlationId });

  let deleted = 0;
  let failed  = 0;

  for (const wh of webhookIds) {
    const id = typeof wh === 'object' ? wh.id : wh;
    try {
      await client.delete(`webhooks/${id}`);
      deleted++;
      console.log('[webhookSync] deleted webhook id=%s storeId=%s', id, storeId);
    } catch (err) {
      // 404 = já removido, tratar como sucesso
      if (err?.status === 404 || err?.message?.includes('404')) {
        deleted++;
      } else {
        failed++;
        console.warn('[webhookSync] delete_failed id=%s storeId=%s err=%s', id, storeId, err?.message);
      }
    }
  }

  console.log('[webhookSync] delete_done storeId=%s deleted=%d failed=%d', storeId, deleted, failed);
  return { deleted, failed };
}
