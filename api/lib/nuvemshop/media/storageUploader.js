// =============================================================================
// storageUploader — Upload de imagens e registros em company_media_library
//                   e catalog_item_media
//
// Responsabilidade exclusiva: receber o buffer validado, fazer upload para
// o Supabase Storage, criar/atualizar company_media_library e
// catalog_item_media.
//
// ── Estratégia de bucket ─────────────────────────────────────────────────────
// Bucket: 'aws-lovoocrm-media' (público — mesmo bucket da media library)
//
// S3 key: nuvemshop/{company_id}/{nuvemshop_product_id}/{nuvemshop_image_id}.{ext}
//   - Isolamento por empresa garantido pelo company_id no path
//   - Nunca compartilha paths entre empresas diferentes
//   - Idempotente: mesmo key = mesmo asset (upsert: true no storage)
//
// URL permanente: gerada por svc.storage.from(BUCKET).getPublicUrl(s3Key)
//   - Estável, não expira
//   - É esta URL que é persistida em company_media_library.preview_url
//   - NUNCA persistir a source_url da CDN da Nuvemshop
//
// ── Idempotência ─────────────────────────────────────────────────────────────
// company_media_library: ON CONFLICT (company_id, s3_key) → UPDATE
// catalog_item_media:    ON CONFLICT (company_id, product_id, library_asset_id, usage_role) → UPDATE
// =============================================================================

const STORAGE_BUCKET = 'aws-lovoocrm-media';
const NUVEMSHOP_FOLDER = '/nuvemshop';

/**
 * Constrói o S3 key para a imagem.
 * Estrutura: nuvemshop/{company_id}/{product_id}/{image_id}.{ext}
 *
 * @param {{ companyId: string, nuvemshopProductId: string, nuvemshopImageId: string, ext: string }}
 * @returns {string}
 */
export function buildS3Key({ companyId, nuvemshopProductId, nuvemshopImageId, ext }) {
  return `nuvemshop/${companyId}/${nuvemshopProductId}/${nuvemshopImageId}.${ext}`;
}

/**
 * Faz upload do buffer para o Supabase Storage e cria/atualiza o registro
 * em company_media_library.
 *
 * Idempotente: se o s3Key já existir para a empresa, o upsert atualiza
 * o registro existente e retorna o mesmo library_asset_id.
 *
 * @param {{
 *   svc:               object,   // supabaseAdmin
 *   companyId:         string,
 *   s3Key:             string,
 *   buffer:            Uint8Array,
 *   mimeType:          string,
 *   fileSize:          number,
 *   originalFilename:  string,
 * }} params
 * @returns {Promise<string>} library_asset_id (UUID)
 */
export async function uploadAndUpsertLibrary({
  svc, companyId, s3Key, buffer, mimeType, fileSize, originalFilename,
}) {
  // 1. Upload para Supabase Storage
  // upsert: true → idempotente; mesmo key substitui o arquivo existente
  const { error: uploadErr } = await svc.storage
    .from(STORAGE_BUCKET)
    .upload(s3Key, buffer, {
      contentType:  mimeType,
      upsert:       true,
      cacheControl: '31536000',  // 1 ano (imagens de produto são imutáveis por URL)
    });

  if (uploadErr) {
    throw new Error(`storage_upload_failed: ${uploadErr.message}`);
  }

  // 2. URL permanente (não é a URL da CDN da Nuvemshop)
  const { data: { publicUrl } } = svc.storage.from(STORAGE_BUCKET).getPublicUrl(s3Key);

  // 3. Upsert em company_media_library
  const { data: asset, error: libErr } = await svc
    .from('company_media_library')
    .upsert(
      {
        company_id:        companyId,
        s3_key:            s3Key,
        original_filename: originalFilename,
        folder_path:       NUVEMSHOP_FOLDER,
        file_type:         'image',
        mime_type:         mimeType,
        file_size:         fileSize,
        preview_url:       publicUrl,
      },
      { onConflict: 'company_id,s3_key' },
    )
    .select('id')
    .single();

  if (libErr) {
    throw new Error(`library_upsert_failed: ${libErr.message}`);
  }

  return asset.id;
}

/**
 * Cria ou atualiza o vínculo entre produto e asset da biblioteca.
 *
 * usage_role = 'presentation': imagens de produto para exibição no catálogo.
 * O trigger trg_validate_catalog_item_media_company valida no banco que
 * produto, asset e empresa coincidem (proteção multi-tenant).
 *
 * Idempotente: unique index em (company_id, product_id, library_asset_id, usage_role).
 *
 * @param {{
 *   svc:            object,
 *   companyId:      string,
 *   productId:      string,  // UUID interno do produto em products.id
 *   libraryAssetId: string,
 *   sortOrder:      number,
 * }} params
 */
export async function upsertCatalogItemMedia({ svc, companyId, productId, libraryAssetId, sortOrder }) {
  const { error } = await svc
    .from('catalog_item_media')
    .upsert(
      {
        company_id:       companyId,
        product_id:       productId,
        library_asset_id: libraryAssetId,
        media_type:       'image',
        usage_role:       'presentation',
        sort_order:       sortOrder,
        is_active:        true,
        use_in_ai:        true,
        metadata:         {},
      },
      { onConflict: 'company_id,product_id,library_asset_id,usage_role', ignoreDuplicates: false },
    );

  if (error) {
    throw new Error(`catalog_item_media_upsert_failed: ${error.message}`);
  }
}
