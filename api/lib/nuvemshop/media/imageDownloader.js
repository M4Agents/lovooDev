// =============================================================================
// imageDownloader — Download e validação de imagens da CDN da Nuvemshop
//
// Responsabilidade exclusiva: baixar imagem de uma URL de CDN e validar
// o resultado antes de retornar o buffer para upload.
//
// ── Estratégia de bucket (Plano v5.1) ─────────────────────────────────────
// O projeto usa o bucket 'aws-lovoocrm-media' como bucket PÚBLICO.
// A URL final persistida em company_media_library.preview_url é obtida via
// svc.storage.from(BUCKET).getPublicUrl(s3Key) — URL permanente e estável.
//
// URLs da CDN da Nuvemshop são TEMPORÁRIAS e nunca persistidas como link final.
// Após o download, apenas o buffer (bytes) segue para o upload.
//
// ── Validações obrigatórias ─────────────────────────────────────────────────
// 1. HTTP 200 (non-2xx lança erro com status para decisão de retry vs dead)
// 2. Content-Type deve ser image/* (rejeita assets não-imagem)
// 3. Tamanho do buffer: 0 < size < MAX_IMAGE_SIZE_BYTES
// 4. Extensão inferida da URL e do Content-Type (com fallback seguro)
// =============================================================================

const DOWNLOAD_TIMEOUT_MS  = 30_000;
const MAX_IMAGE_SIZE_BYTES  = 25 * 1024 * 1024;  // 25 MB

const VALID_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']);

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
  'image/avif': 'avif',
};

const EXT_TO_MIME = {
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
  gif:  'image/gif',
  avif: 'image/avif',
};

/**
 * Extrai a extensão da URL da imagem (sem query string).
 * Retorna null se não encontrar extensão válida.
 *
 * @param {string} url
 * @returns {string|null} extensão sem ponto (ex: 'jpg') ou null
 */
function extractExtFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
    return VALID_EXTENSIONS.has(ext) ? ext : null;
  } catch {
    return null;
  }
}

/**
 * Extrai a extensão a partir do Content-Type.
 * @param {string} contentType
 * @returns {string|null}
 */
function extFromMime(contentType) {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[mime] ?? null;
}

// ── Interface pública ──────────────────────────────────────────────────────────

/**
 * Resultado do download.
 * @typedef {{
 *   buffer:   Uint8Array,
 *   mimeType: string,
 *   fileSize: number,
 *   ext:      string,
 * }} DownloadResult
 */

/**
 * Baixa uma imagem de CDN com validação completa.
 *
 * Validações executadas (todas lançam Error antes do upload):
 *   1. HTTP 200 — falha com err.httpStatus para decisão de retry/dead no worker
 *   2. Content-Type image/* — rejeita assets não-imagem
 *   3. Buffer > 0 bytes
 *   4. Buffer ≤ MAX_IMAGE_SIZE_BYTES (25 MB)
 *
 * A URL da CDN é TEMPORÁRIA. Apenas o buffer retornado deve ser persistido.
 * Nunca armazenar a sourceUrl como link final.
 *
 * @param {string} sourceUrl  URL da CDN da Nuvemshop (temporária)
 * @returns {Promise<DownloadResult>}
 * @throws {Error} com err.httpStatus se o servidor retornar non-200
 */
export async function downloadImage(sourceUrl) {
  let response;
  try {
    response = await fetch(sourceUrl, {
      headers: { 'User-Agent': 'LoovooCRM/1.0 (media-worker)' },
      signal:  AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (err) {
    throw Object.assign(
      new Error(`download_network_error: ${err.message}`),
      { retryable: true },
    );
  }

  // 1. Validar status HTTP
  if (!response.ok) {
    const err = Object.assign(
      new Error(`download_http_error: HTTP ${response.status} para ${sourceUrl}`),
      { httpStatus: response.status, retryable: response.status >= 500 },
    );
    throw err;
  }

  // 2. Validar Content-Type
  const rawContentType = response.headers.get('content-type') ?? '';
  const cleanMime      = rawContentType.split(';')[0].trim().toLowerCase();

  if (!cleanMime.startsWith('image/')) {
    throw Object.assign(
      new Error(`download_invalid_content_type: esperado image/*, recebido '${cleanMime}'`),
      { retryable: false },
    );
  }

  // 3. Ler buffer
  const buffer   = new Uint8Array(await response.arrayBuffer());
  const fileSize = buffer.length;

  if (fileSize === 0) {
    throw Object.assign(
      new Error('download_empty_buffer: resposta 200 mas buffer vazio'),
      { retryable: true },
    );
  }

  // 4. Validar tamanho máximo
  if (fileSize > MAX_IMAGE_SIZE_BYTES) {
    throw Object.assign(
      new Error(`download_too_large: ${fileSize} bytes excede ${MAX_IMAGE_SIZE_BYTES} (25 MB)`),
      { retryable: false },
    );
  }

  // Determinar extensão: URL → Content-Type → fallback 'jpg'
  const ext      = extractExtFromUrl(sourceUrl) ?? extFromMime(cleanMime) ?? 'jpg';
  const mimeType = EXT_TO_MIME[ext] ?? cleanMime;

  return { buffer, mimeType, fileSize, ext };
}
