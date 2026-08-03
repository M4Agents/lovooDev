// =============================================================================
// categoryHandler — Handler de eventos category/* da Nuvemshop
//
// Responsabilidades deste Handler (conforme Plano v5.1):
//   1. Validar parâmetros do contexto
//   2. Obter conexão ativa e descriptografar token
//   3. Para created/updated: buscar dados completos via API Nuvemshop
//   4. Delegar toda a lógica de escrita ao categorySync (Sync Service)
//   5. Retornar { ok: true } ou lançar Error (worker trata retry/dead)
//
// O handler NÃO:
//   - controla lock ou heartbeat
//   - faz claim de eventos
//   - acessa diretamente catalog_categories
//   - implementa retry próprio
//
// Topics suportados:
//   category/created, category/updated, category/deleted
// =============================================================================

import { getSupabaseAdmin }         from '../../automation/supabaseAdmin.js';
import { decryptNuvemshopToken }    from '../tokenCrypto.js';
import { createNuvemshopClient }    from '../nuvemshopClient.js';
import { upsertCategory, softDeleteCategory } from '../sync/categorySync.js';

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
export async function categoryHandler(ctx) {
  const { companyId, storeId, topic, payload, correlationId } = ctx;

  // ── Validação de parâmetros ──────────────────────────────────────────────
  const nuvemshopCategoryId = String(payload?.id ?? '');
  if (!nuvemshopCategoryId || nuvemshopCategoryId === 'undefined') {
    throw new Error('[categoryHandler] category ID ausente no payload');
  }

  if (!companyId || !storeId) {
    throw new Error('[categoryHandler] companyId e storeId são obrigatórios');
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
    throw new Error(`[categoryHandler] Erro ao buscar conexão: ${connErr.message}`);
  }
  if (!connection) {
    // Conexão foi desconectada entre o enqueue e o processamento — skip silencioso
    console.warn('[categoryHandler] connection_not_active companyId=%s storeId=%s corr=%s',
      companyId, storeId, correlationId);
    return { ok: true };
  }

  // ── Soft delete ───────────────────────────────────────────────────────────
  if (topic === 'category/deleted') {
    const result = await softDeleteCategory({
      companyId,
      storeId,
      nuvemshopCategoryId,
      svc,
    });

    console.log('[categoryHandler] soft_deleted nuvemshopId=%s companyId=%s found=%s corr=%s',
      nuvemshopCategoryId, companyId, result.found, correlationId);

    return { ok: true };
  }

  // ── Descriptografar token ─────────────────────────────────────────────────
  let accessToken;
  try {
    accessToken = decryptNuvemshopToken(connection.access_token_enc);
  } catch (err) {
    throw new Error(`[categoryHandler] Falha ao descriptografar token: ${err.message}`);
  }

  // ── Buscar dados completos da categoria ───────────────────────────────────
  const client = createNuvemshopClient({ storeId, accessToken, correlationId });

  let categoryData;
  try {
    categoryData = await client.get(`categories/${nuvemshopCategoryId}`);
  } catch (err) {
    // 404: categoria pode ter sido deletada entre o webhook e o processamento
    if (err?.status === 404) {
      console.warn('[categoryHandler] category_not_found_in_api nuvemshopId=%s companyId=%s corr=%s',
        nuvemshopCategoryId, companyId, correlationId);

      // Tratar como soft delete (a categoria não existe mais)
      await softDeleteCategory({ companyId, storeId, nuvemshopCategoryId, svc });
      return { ok: true };
    }
    throw new Error(`[categoryHandler] Falha ao buscar categoria ${nuvemshopCategoryId}: ${err.message}`);
  }

  if (!categoryData) {
    throw new Error(`[categoryHandler] Resposta vazia para categoria ${nuvemshopCategoryId}`);
  }

  // ── Upsert via Sync Service ───────────────────────────────────────────────
  const syncResult = await upsertCategory({
    companyId,
    storeId,
    categoryData,
    svc,
  });

  console.log('[categoryHandler] synced topic=%s nuvemshopId=%s action=%s name=%s corr=%s',
    topic, nuvemshopCategoryId, syncResult.action, syncResult.name, correlationId);

  return { ok: true };
}
