// =============================================================================
// GET /api/cron/nuvemshop-process-media
//
// Worker do pipeline de mídias Nuvemshop — executado pelo Vercel Cron.
//
// Fluxo por item da fila:
//   1. Claim atômico via RPC (FOR UPDATE SKIP LOCKED)
//   2. Resolver product_id (localiza pelo external_id se product_id for null)
//   3. Download + validação (imageDownloader)
//   4. Upload + library (storageUploader)
//   5. Vínculo catalog_item_media (storageUploader)
//   6. Marcar item como 'processed'
//   → Em falha: incrementar attempts, last_error, agendar retry ou marcar dead
//
// Segurança:
//   - company_id validado antes de qualquer escrita
//   - Mídias isoladas por empresa (path inclui company_id)
//   - URLs temporárias da CDN não são persistidas
//   - Apenas service_role acessa tabelas operacionais
//
// Módulos:
//   - imageDownloader.js — download e validação da imagem
//   - storageUploader.js — upload, library e catalog_item_media
// =============================================================================

import { cronGuard }           from '../lib/cronGuard.js';
import { randomBytes }          from 'crypto';
import { getSupabaseAdmin }     from '../lib/automation/supabaseAdmin.js';
import { downloadImage }        from '../lib/nuvemshop/media/imageDownloader.js';
import {
  buildS3Key,
  uploadAndUpsertLibrary,
  upsertCatalogItemMedia,
}                               from '../lib/nuvemshop/media/storageUploader.js';

const WORKER_PREFIX   = 'nv-media';
const BATCH_SIZE      = 5;
const MAX_RETRIES     = 3;
const BACKOFF_CAP_SEC = 1_800;  // 30 min

function makeWorkerId() {
  return `${WORKER_PREFIX}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

function calcNextRetryBackoff(attempts) {
  return Math.min(120 * Math.pow(2, attempts), BACKOFF_CAP_SEC);
}

// ── Processamento de item individual ──────────────────────────────────────────

/**
 * Processa um único item da nuvemshop_media_queue.
 * @returns {Promise<'processed'|'failed'|'dead'>}
 */
async function processMediaItem({ svc, item, workerId }) {
  const {
    id,
    company_id:           companyId,
    store_id:             storeId,
    product_id:           rawProductId,
    nuvemshop_product_id: nuvemshopProductId,
    nuvemshop_image_id:   nuvemshopImageId,
    source_url:           sourceUrl,
    position,
    attempts,
  } = item;

  const log = (level, event, extra = {}) => console.log(JSON.stringify({
    level, event, worker_id: workerId,
    company_id:           companyId,
    store_id:             storeId,
    nuvemshop_product_id: nuvemshopProductId,
    nuvemshop_image_id:   nuvemshopImageId,
    media_queue_id:       id,
    ...extra,
  }));

  try {
    // ── 1. Resolver product_id ────────────────────────────────────────────────
    // Nuvemshop pode enfileirar a mídia antes de o produto ser salvo (race condition).
    let productId = rawProductId;

    if (productId) {
      // Validar que o produto pertence à empresa (proteção multi-tenant)
      const { data: prod } = await svc
        .from('products')
        .select('id, company_id')
        .eq('id', productId)
        .maybeSingle();

      if (!prod || prod.company_id !== companyId) {
        throw Object.assign(
          new Error(`company_mismatch: product_id ${productId} não pertence à empresa ${companyId}`),
          { retryable: false },
        );
      }
    } else {
      log('warn', 'media_product_id_null_searching_by_external_id');

      const { data: prod } = await svc
        .from('products')
        .select('id, company_id')
        .eq('company_id', companyId)
        .eq('external_source', 'nuvemshop')
        .eq('external_id', String(nuvemshopProductId))
        .maybeSingle();

      if (!prod) {
        throw Object.assign(
          new Error(`product_not_found: external_id ${nuvemshopProductId} não encontrado para empresa ${companyId}`),
          { retryable: true },
        );
      }

      productId = prod.id;
      await svc.from('nuvemshop_media_queue').update({ product_id: productId }).eq('id', id);
    }

    // ── 2. Download + validação ────────────────────────────────────────────────
    log('info', 'media_download_start');
    const { buffer, mimeType, fileSize, ext } = await downloadImage(sourceUrl);
    log('info', 'media_download_ok', { file_size: fileSize, mime_type: mimeType, ext });

    // ── 3. Upload + library ────────────────────────────────────────────────────
    const s3Key           = buildS3Key({ companyId, nuvemshopProductId, nuvemshopImageId, ext });
    const originalFilename = `${nuvemshopImageId}.${ext}`;

    log('info', 'media_upload_start', { s3_key: s3Key });

    const libraryAssetId = await uploadAndUpsertLibrary({
      svc, companyId, s3Key, buffer, mimeType, fileSize, originalFilename,
    });

    log('info', 'media_upload_ok', { library_asset_id: libraryAssetId, s3_key: s3Key });

    // ── 4. Vínculo catalog_item_media ─────────────────────────────────────────
    await upsertCatalogItemMedia({
      svc, companyId, productId, libraryAssetId, sortOrder: position ?? 0,
    });

    // ── 4b. Foto principal do produto (position = 0) ───────────────────────────
    // A primeira imagem (position=0) define o visual do card do produto no CRM.
    // Usamos a URL permanente do Storage (nunca a CDN da Nuvemshop).
    if ((position ?? 0) === 0) {
      const { data: { publicUrl } } = svc.storage
        .from('aws-lovoocrm-media')
        .getPublicUrl(s3Key);

      await svc
        .from('products')
        .update({ primary_image_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', productId)
        .eq('company_id', companyId);

      log('info', 'media_primary_image_set', { product_id: productId });
    }

    // ── 5. Marcar como processed ──────────────────────────────────────────────
    await svc
      .from('nuvemshop_media_queue')
      .update({ status: 'processed', processed_at: new Date().toISOString(), last_error: null })
      .eq('id', id);

    log('info', 'media_processed_ok', { library_asset_id: libraryAssetId });
    return 'processed';

  } catch (err) {
    const isRetryable  = err.retryable !== false && !err.httpStatus || (err.httpStatus ?? 0) >= 500;
    const newAttempts  = (attempts ?? 0) + 1;
    const isDead       = newAttempts >= MAX_RETRIES || !isRetryable;
    const nextStatus   = isDead ? 'dead' : 'failed';

    console.error(JSON.stringify({
      level:              'error',
      event:              'media_item_failed',
      worker_id:          workerId,
      company_id:         companyId,
      media_queue_id:     id,
      nuvemshop_image_id: nuvemshopImageId,
      attempts:           newAttempts,
      is_dead:            isDead,
      retryable:          isRetryable,
      error:              err.message,
    }));

    await svc
      .from('nuvemshop_media_queue')
      .update({
        status:     nextStatus,
        attempts:   newAttempts,
        last_error: err.message?.slice(0, 500),
        worker_id:  null,
      })
      .eq('id', id);

    return isDead ? 'dead' : 'failed';
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (!cronGuard(req, res)) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const workerId = makeWorkerId();
  const svc      = getSupabaseAdmin();
  const startAt  = Date.now();

  console.log(JSON.stringify({
    level: 'info', event: 'media_worker_start',
    worker_id: workerId, batch_size: BATCH_SIZE, max_retries: MAX_RETRIES,
  }));

  // ── Claim atômico via RPC (SKIP LOCKED) ───────────────────────────────────
  const { data: batch, error: claimErr } = await svc
    .rpc('claim_nuvemshop_media_batch', {
      p_worker_id:   workerId,
      p_batch_size:  BATCH_SIZE,
      p_max_retries: MAX_RETRIES,
    });

  if (claimErr) {
    console.error(JSON.stringify({
      level: 'error', event: 'media_claim_failed',
      worker_id: workerId, error: claimErr.message,
    }));
    return res.status(500).json({ error: 'claim_failed' });
  }

  const items = batch ?? [];

  if (items.length === 0) {
    console.log(JSON.stringify({ level: 'info', event: 'media_worker_idle', worker_id: workerId }));
    return res.status(200).json({ ok: true, processed: 0, idle: true });
  }

  // ── Processar cada item ────────────────────────────────────────────────────
  const outcomes = { processed: 0, failed: 0, dead: 0 };
  for (const item of items) {
    const outcome = await processMediaItem({ svc, item, workerId });
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }

  const elapsed = Date.now() - startAt;
  console.log(JSON.stringify({
    level: 'info', event: 'media_worker_done',
    worker_id: workerId, total: items.length, ...outcomes, elapsed_ms: elapsed,
  }));

  return res.status(200).json({ ok: true, worker_id: workerId, ...outcomes, elapsed_ms: elapsed });
}
