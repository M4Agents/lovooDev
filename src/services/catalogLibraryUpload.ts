/**
 * Upload para company_media_library com regras específicas do catálogo (produto/serviço).
 * Não altera o comportamento global da biblioteca — uso apenas neste fluxo.
 */

export const CATALOG_MEDIA_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const CATALOG_MEDIA_MAX_VIDEO_BYTES = 30 * 1024 * 1024
export const CATALOG_MEDIA_MAX_FILES_PER_BATCH = 10

export type CatalogLibrarySavedAsset = {
  id: string
  s3_key?: string
  file_type?: string
  original_filename?: string
  [key: string]: unknown
}

export function validateCatalogMediaFile(file: File): { ok: true } | { ok: false; message: string } {
  let fileType: 'image' | 'video' | 'other' = 'other'
  if (file.type.startsWith('image/')) fileType = 'image'
  else if (file.type.startsWith('video/')) fileType = 'video'

  if (fileType === 'other') {
    return {
      ok: false,
      message: 'Apenas imagens e vídeos são permitidos no catálogo.',
    }
  }

  if (fileType === 'image' && file.size > CATALOG_MEDIA_MAX_IMAGE_BYTES) {
    return {
      ok: false,
      message: `Imagem acima de ${CATALOG_MEDIA_MAX_IMAGE_BYTES / (1024 * 1024)} MB.`,
    }
  }
  if (fileType === 'video' && file.size > CATALOG_MEDIA_MAX_VIDEO_BYTES) {
    return {
      ok: false,
      message: `Vídeo acima de ${CATALOG_MEDIA_MAX_VIDEO_BYTES / (1024 * 1024)} MB.`,
    }
  }

  return { ok: true }
}

/** Retorna o folder_path canônico da pasta de sistema de acordo com sourceType. */
export function catalogFolderPath(sourceType: 'product' | 'service'): '/produtos' | '/servicos' {
  return sourceType === 'product' ? '/produtos' : '/servicos'
}

/**
 * Upload S3 + save-metadata (mesmo pipeline da biblioteca).
 * sourceType determina a pasta de sistema de destino (Produtos / Serviços).
 */
export async function uploadCatalogMediaToLibrary(
  file: File,
  companyId: string,
  sourceType: 'product' | 'service' = 'product'
): Promise<{ ok: true; data: CatalogLibrarySavedAsset } | { ok: false; error: string }> {
  const v = validateCatalogMediaFile(file)
  if (!v.ok) return { ok: false, error: v.message }

  let fileType: 'image' | 'video' = 'image'
  if (file.type.startsWith('video/')) fileType = 'video'
  else if (!file.type.startsWith('image/')) {
    return { ok: false, error: 'Tipo de arquivo não suportado.' }
  }

  try {
    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)
    const { S3Storage } = await import('./aws/s3Storage')
    const contentType = S3Storage.detectContentType(buffer, file.name)
    const messageId = `catalog-upload-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`

    const uploadResult = await S3Storage.uploadToS3({
      companyId,
      messageId,
      originalFileName: file.name,
      buffer,
      contentType,
      source: 'biblioteca',
    })

    if (!uploadResult.success || !uploadResult.data) {
      return { ok: false, error: uploadResult.error || 'Falha no upload para o armazenamento.' }
    }

    const signedUrlResult = await S3Storage.generateSignedUrl(companyId, uploadResult.data.s3Key, {
      expiresIn: 7200,
    })
    if (!signedUrlResult.success || !signedUrlResult.data) {
      return { ok: false, error: signedUrlResult.error || 'Falha ao gerar URL de preview.' }
    }

    const metadataPayload = {
      company_id: companyId,
      original_filename: file.name,
      file_type: fileType,
      mime_type: file.type,
      file_size: file.size,
      s3_key: uploadResult.data.s3Key,
      preview_url: signedUrlResult.data,
      folder_path: catalogFolderPath(sourceType),
    }

    const metadataResponse = await fetch('/api/media-library/save-catalog-metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadataPayload),
    })

    if (!metadataResponse.ok) {
      const errorData = await metadataResponse.json().catch(() => ({}))
      return {
        ok: false,
        error: (errorData as { error?: string }).error || 'Falha ao salvar metadados na biblioteca.',
      }
    }

    const metadataResult = await metadataResponse.json()
    if (!metadataResult.success || !metadataResult.data?.id) {
      return { ok: false, error: metadataResult.error || 'Falha ao salvar metadados na biblioteca.' }
    }

    return { ok: true, data: metadataResult.data as CatalogLibrarySavedAsset }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Erro inesperado no upload.',
    }
  }
}
