// =============================================================================
// mediaAsset.js — Meta WhatsApp Media Asset Validation Layer (MVP4B.4C.1)
//
// Responsabilidade: validar um asset de company_media_library para uso como
// HEADER de template Meta (IMAGE/VIDEO/DOCUMENT).
//
// NÃO faz chamadas à Graph API.
// NÃO escreve no storage.
// NÃO modifica o banco.
//
// Fluxo:
//   1. Validação de inputs (companyId, assetId, expectedMediaType)
//   2. Lookup tenant-safe em company_media_library
//   3. Pre-check de tamanho via DB file_size (hint, não autoridade)
//   4. Download do storage (backend → storage, nunca frontend)
//   5. Validação de tamanho real (autoridade)
//   6. Detecção de MIME pelos bytes reais (fileTypeFromBlob)
//   7. Verificação de whitelist conservadora
//   8. Verificação de compatibilidade com expectedMediaType
//   9. Sanitização de filename (somente DOCUMENT)
//
// Entrada:
//   validateMediaAsset({ supabase, companyId, assetId, expectedMediaType })
//
// Saída:
//   { assetId, blob, mimeType, size, mediaType, filename? }
//
// Segurança:
//   - company_id vem SOMENTE do auth/backend — nunca do frontend/asset.
//   - Lookup cross-tenant é opaco: idêntico a asset inexistente.
//   - mime_type, file_type e original_filename do DB NÃO são autoridade de segurança.
//   - Somente bytes reais determinam o MIME aceito.
//   - Nenhum log de bytes, conteúdo ou credenciais.
// =============================================================================

import { fileTypeFromBlob } from 'file-type';

// =============================================================================
// Constantes
// =============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_MEDIA_TYPES = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

// Bucket Supabase Storage onde os assets de company_media_library estão armazenados.
const STORAGE_BUCKET = 'aws-lovoocrm-media';

// Limite máximo de tamanho por tipo de media.
//
// IMAGE e VIDEO: valores per Meta Cloud API documentation (endpoint /media).
// DOCUMENT: ENGINEERING SAFETY LIMIT — NÃO é o limite oficial da Meta.
//   A Meta permite até 100 MB no endpoint /media para documentos.
//   Este limite de 30 MB é uma decisão de engenharia conservadora para:
//   (a) proteger contra pressão de memória no runtime Vercel (pico ~2–3× tamanho),
//   (b) reduzir risco de timeout no upload para a Graph API.
//   Ajuste via revisão explícita quando o limite Meta for confirmado para HEADER de template.
const MEDIA_SIZE_LIMITS = {
  IMAGE:    5  * 1024 * 1024, //  5 MB — Meta documentation
  VIDEO:    16 * 1024 * 1024, // 16 MB — Meta documentation
  DOCUMENT: 30 * 1024 * 1024, // 30 MB — ENGINEERING SAFETY LIMIT (not Meta limit)
};

// Whitelist conservadora — Fase 1.
//
// Incluídos: formatos amplamente documentados para template HEADER.
// Excluídos:
//   image/webp   — suportado pelo endpoint /media, mas pendente confirmação para template HEADER.
//   DOCX/XLSX/PPTX — file-type detecta (ZIP-based), mas aceite pelo Meta para HEADER pendente.
//   DOC/XLS/PPT  — file-type não suporta (OLE2/CFB). Retorna application/x-cfb. Excluído permanentemente.
//
// Fail-closed: qualquer MIME fora desta whitelist é rejeitado.
const MIME_TO_MEDIA_TYPE = new Map([
  ['image/jpeg',      'IMAGE'],
  ['image/png',       'IMAGE'],
  ['video/mp4',       'VIDEO'],
  ['video/3gpp',      'VIDEO'],
  ['application/pdf', 'DOCUMENT'],
]);

// Tamanho máximo do filename sanitizado.
const MAX_FILENAME_LEN       = 200;
const FALLBACK_DOC_FILENAME  = 'document.pdf';

// =============================================================================
// Helpers privados
// =============================================================================

/**
 * Cria um Error com propriedade `code` determinística.
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function makeAssetError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Sanitiza o filename de um asset DOCUMENT.
 *
 * Requisitos:
 *   - Remove caracteres de controle (0x00-0x1f, 0x7f)
 *   - Remove separadores de path (/ e \)
 *   - Neutraliza sequências de traversal (..)
 *   - Trim de espaços
 *   - Limita a MAX_FILENAME_LEN caracteres
 *   - Rejeita resultado "." ou ".." → fallback
 *   - Rejeita string vazia → fallback
 *
 * NÃO infere MIME pela extensão. Filename é apenas metadata de display.
 *
 * @param {unknown} raw
 * @returns {string}
 */
function sanitizeFilename(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return FALLBACK_DOC_FILENAME;
  }

  let name = raw
    .replace(/[\x00-\x1f\x7f]/g, '') // Remove caracteres de controle
    .replace(/[/\\]/g, '')             // Remove path separators (antes de checar dots)
    .replace(/\.{2,}/g, '.')           // Colapsa qualquer sequência de 2+ dots (anti-traversal)
    .trim();

  if (name.length > MAX_FILENAME_LEN) {
    name = name.slice(0, MAX_FILENAME_LEN);
  }

  if (name === '' || name === '.' || name === '..') {
    return FALLBACK_DOC_FILENAME;
  }

  return name;
}

// =============================================================================
// Função principal
// =============================================================================

/**
 * Valida um asset de company_media_library para uso como HEADER de template Meta.
 *
 * Não chama a Graph API. Não escreve no storage. Não modifica o banco.
 *
 * @param {object} params
 * @param {import('@supabase/supabase-js').SupabaseClient} params.supabase
 *   Client Supabase com service_role. Injetar via getSupabaseAdmin().
 * @param {string} params.companyId
 *   UUID do tenant autenticado. Vem exclusivamente do auth/backend.
 * @param {string} params.assetId
 *   UUID do asset em company_media_library.
 * @param {'IMAGE'|'VIDEO'|'DOCUMENT'} params.expectedMediaType
 *   Tipo de media esperado para o HEADER do template.
 *
 * @returns {Promise<{
 *   assetId:   string,
 *   blob:      Blob,
 *   mimeType:  string,
 *   size:      number,
 *   mediaType: 'IMAGE'|'VIDEO'|'DOCUMENT',
 *   filename?: string,
 * }>}
 *
 * @throws {Error & { code: string }} com codes:
 *   media_asset_invalid          — input inválido
 *   media_asset_not_found        — asset não encontrado (opaco — cross-tenant indistinguível)
 *   media_asset_download_failed  — falha no download do storage
 *   media_asset_too_large        — tamanho excede limite (pre-check DB ou bytes reais)
 *   media_asset_type_unknown     — MIME não detectável pelos bytes
 *   media_asset_type_unsupported — MIME detectado, mas fora da whitelist
 *   media_asset_type_mismatch    — MIME compatível, mas incompatível com expectedMediaType
 */
export async function validateMediaAsset({ supabase, companyId, assetId, expectedMediaType }) {
  // ── 1. Validação de inputs ───────────────────────────────────────────────
  if (!companyId || !UUID_RE.test(companyId)) {
    throw makeAssetError('media_asset_invalid', 'companyId inválido');
  }
  if (!assetId || !UUID_RE.test(assetId)) {
    throw makeAssetError('media_asset_invalid', 'assetId inválido');
  }
  if (!VALID_MEDIA_TYPES.has(expectedMediaType)) {
    throw makeAssetError('media_asset_invalid', `expectedMediaType inválido: ${expectedMediaType}`);
  }

  // ── 2. Lookup tenant-safe ────────────────────────────────────────────────
  // Obrigatório: id = assetId AND company_id = companyId.
  // Cross-tenant e inexistente são indistinguíveis (resposta opaca).
  const { data: asset, error: dbError } = await supabase
    .from('company_media_library')
    .select('id, company_id, s3_key, file_size, mime_type, original_filename, file_type')
    .eq('id', assetId)
    .eq('company_id', companyId)
    .maybeSingle();

  if (dbError || !asset) {
    throw makeAssetError('media_asset_not_found', 'Asset não encontrado');
  }

  // ── 3. Pre-check de tamanho via DB (hint) ───────────────────────────────
  // DB file_size é hint — pode estar defasado. Usado somente para rejeição rápida
  // antes do download, evitando transferência desnecessária de arquivos grandes.
  // O check autoritativo dos bytes reais ocorre no passo 5.
  const sizeLimit = MEDIA_SIZE_LIMITS[expectedMediaType];
  if (typeof asset.file_size === 'number' && asset.file_size > sizeLimit) {
    throw makeAssetError(
      'media_asset_too_large',
      `Tamanho no DB (${asset.file_size} bytes) excede limite de ${sizeLimit} bytes`,
    );
  }

  // ── 4. Download do storage ───────────────────────────────────────────────
  // s3_key vem exclusivamente da row tenant-safe do banco — nunca do frontend.
  const { data: blob, error: downloadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(asset.s3_key);

  if (downloadError || !blob) {
    throw makeAssetError('media_asset_download_failed', 'Falha no download do storage');
  }

  // ── 5. Validação de tamanho real (autoridade) ────────────────────────────
  if (blob.size > sizeLimit) {
    throw makeAssetError(
      'media_asset_too_large',
      `Tamanho real (${blob.size} bytes) excede limite de ${sizeLimit} bytes`,
    );
  }

  // ── 6. Detecção de MIME pelos bytes reais ────────────────────────────────
  // mime_type do DB NÃO é fonte de verdade para segurança.
  // file_type do DB NÃO é fonte de verdade para segurança.
  // Extensão do original_filename NÃO é fonte de verdade.
  // Somente os bytes reais determinam o MIME aceito.
  const detected = await fileTypeFromBlob(blob);

  if (!detected) {
    throw makeAssetError(
      'media_asset_type_unknown',
      'MIME não detectável pelos bytes do arquivo',
    );
  }

  // ── 7. Whitelist conservadora ────────────────────────────────────────────
  const detectedMediaType = MIME_TO_MEDIA_TYPE.get(detected.mime);

  if (!detectedMediaType) {
    throw makeAssetError(
      'media_asset_type_unsupported',
      `MIME detectado fora da whitelist: ${detected.mime}`,
    );
  }

  // ── 8. Compatibilidade com expectedMediaType ─────────────────────────────
  if (detectedMediaType !== expectedMediaType) {
    throw makeAssetError(
      'media_asset_type_mismatch',
      `Esperado ${expectedMediaType}, detectado ${detectedMediaType} (${detected.mime})`,
    );
  }

  // ── 9. Sanitização de filename (somente DOCUMENT) ────────────────────────
  // IMAGE e VIDEO: não dependem de filename para autorização ou envio.
  // DOCUMENT: filename é necessário para o payload Graph (campo `document.filename`).
  // original_filename é hint — sanitização determinística obrigatória.
  const filename = expectedMediaType === 'DOCUMENT'
    ? sanitizeFilename(asset.original_filename)
    : undefined;

  return {
    assetId:   asset.id,
    blob,
    mimeType:  detected.mime,
    size:      blob.size,
    mediaType: detectedMediaType,
    ...(filename !== undefined ? { filename } : {}),
  };
}
