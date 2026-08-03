// =============================================================================
// productHandler — Handler de eventos product/* da Nuvemshop
//
// Responsabilidades (conforme Plano v5.1):
//   1. Validar parâmetros do contexto
//   2. Obter conexão ativa e descriptografar token
//   3. Para created/updated: buscar dados completos via API Nuvemshop
//   4. Delegar toda a lógica de escrita ao productSync (Sync Service)
//   5. Retornar { ok: true } ou lançar Error (worker trata retry/dead)
//
// O handler NÃO:
//   - controla lock ou heartbeat
//   - faz claim de eventos
//   - acessa diretamente a tabela products
//   - implementa retry próprio
//   - realiza download de imagens (Fase 7)
//   - acessa opportunity_items (Fase 8+)
//
// Topics suportados:
//   product/created, product/updated, product/deleted
// =============================================================================

import { getSupabaseAdmin }                       from '../../automation/supabaseAdmin.js';
import { decryptNuvemshopToken }                  from '../tokenCrypto.js';
import { createNuvemshopClient }                  from '../nuvemshopClient.js';
import { upsertProduct, softDeleteProduct }       from '../sync/productSync.js';

/**
 * @param {{
 *   companyId:     string,
 *   storeId:       string,
 *   topic:         string,
 *   payload:       object,
 *   correlationId: string,
 *   workerId:      string,
 * }} ctx
 * @returns {Promise<{ ok: boolean }>}
 */
export async function productHandler(ctx) {
  const { companyId, storeId, topic, payload, correlationId } = ctx;

  // ── Validação de parâmetros ──────────────────────────────────────────────
  const nuvemshopProductId = String(payload?.id ?? '');
  if (!nuvemshopProductId || nuvemshopProductId === 'undefined') {
    throw new Error('[productHandler] product ID ausente no payload');
  }

  if (!companyId || !storeId) {
    throw new Error('[productHandler] companyId e storeId são obrigatórios');
  }

  const svc = getSupabaseAdmin();

  // ── Obter conexão ativa e token ───────────────────────────────────────────
  const { data: connection, error: connErr } = await svc
    .from('nuvemshop_connections')
    .select('id, access_token_enc, encryption_version')
    .eq('company_id', companyId)
    .eq('nuvemshop_store_id', storeId)
    .eq('status', 'active')
    .maybeSingle();

  if (connErr) {
    throw new Error(`[productHandler] Erro ao buscar conexão: ${connErr.message}`);
  }

  if (!connection) {
    // Conexão foi desconectada entre o enqueue e o processamento — skip silencioso
    console.warn(JSON.stringify({
      level:        'warn',
      event:        'product_connection_not_active',
      company_id:   companyId,
      store_id:     storeId,
      topic,
      product_id:   nuvemshopProductId,
      correlation_id: correlationId,
    }));
    return { ok: true };
  }

  // ── Soft delete (topic product/deleted) ───────────────────────────────────
  // Produto deletado: não há dados a buscar na API.
  // UUID interno preservado; opportunity_items mantêm referência histórica.
  if (topic === 'product/deleted') {
    const result = await softDeleteProduct({
      companyId,
      storeId,
      nuvemshopProductId,
      svc,
    });

    console.log(JSON.stringify({
      level:          'info',
      event:          'product_soft_deleted',
      topic,
      company_id:     companyId,
      store_id:       storeId,
      nuvemshop_product_id: nuvemshopProductId,
      found:          result.found,
      correlation_id: correlationId,
    }));

    return { ok: true };
  }

  // ── Descriptografar token ─────────────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decryptNuvemshopToken(connection.access_token_enc);
  } catch (err) {
    throw new Error(`[productHandler] Falha ao descriptografar token: ${err.message}`);
  }

  // ── Buscar dados completos do produto via API Nuvemshop ───────────────────
  // A API retorna o objeto completo incluindo variantes, imagens e categorias.
  const client = createNuvemshopClient({ storeId, accessToken, correlationId });

  let productData;
  try {
    productData = await client.get(`products/${nuvemshopProductId}`);
  } catch (err) {
    // 404: produto pode ter sido deletado entre o enqueue e o processamento
    if (err?.status === 404) {
      console.warn(JSON.stringify({
        level:          'warn',
        event:          'product_not_found_in_api_treating_as_deleted',
        company_id:     companyId,
        store_id:       storeId,
        nuvemshop_product_id: nuvemshopProductId,
        topic,
        correlation_id: correlationId,
      }));

      await softDeleteProduct({ companyId, storeId, nuvemshopProductId, svc });
      return { ok: true };
    }
    throw new Error(`[productHandler] Falha ao buscar produto ${nuvemshopProductId}: ${err.message}`);
  }

  if (!productData) {
    throw new Error(`[productHandler] Resposta vazia para produto ${nuvemshopProductId}`);
  }

  // ── Upsert via Sync Service ───────────────────────────────────────────────
  // productSync cuida de: normalizar variantes, resolver categoria,
  // enfileirar mídias e fazer o upsert na tabela products.
  const syncResult = await upsertProduct({
    companyId,
    storeId,
    productData,
    svc,
  });

  console.log(JSON.stringify({
    level:           'info',
    event:           'product_synced',
    topic,
    company_id:      companyId,
    store_id:        storeId,
    nuvemshop_product_id: nuvemshopProductId,
    product_uuid:    syncResult.productUuid,
    action:          syncResult.action,
    correlation_id:  correlationId,
  }));

  return { ok: true };
}
