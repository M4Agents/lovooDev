// =============================================================================
// mediaConstants.js — Constantes compartilhadas para validação de assets Meta
//
// Extraídas de mediaAsset.js (MVP4B.4C.1) para uso compartilhado pelo
// endpoint de importação (MVP4B.4D.2B) sem duplicação de lógica.
//
// IMPORTANTE: qualquer alteração aqui impacta simultaneamente:
//   - api/lib/meta-whatsapp/mediaAsset.js   (validateMediaAsset)
//   - api/whatsapp/meta/media/import.js      (importação lead_media_unified)
// =============================================================================

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const VALID_MEDIA_TYPES = new Set(['IMAGE', 'VIDEO', 'DOCUMENT']);

// Limite máximo de tamanho por tipo de media.
//
// IMAGE e VIDEO: valores per Meta Cloud API documentation (endpoint /media).
// DOCUMENT: ENGINEERING SAFETY LIMIT — NÃO é o limite oficial da Meta.
//   A Meta permite até 100 MB no endpoint /media para documentos.
//   Este limite de 30 MB é uma decisão de engenharia conservadora para:
//   (a) proteger contra pressão de memória no runtime Vercel (pico ~2–3× tamanho),
//   (b) reduzir risco de timeout no upload para a Graph API.
//   Ajuste via revisão explícita quando o limite Meta for confirmado para HEADER de template.
export const MEDIA_SIZE_LIMITS = {
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
export const MIME_TO_MEDIA_TYPE = new Map([
  ['image/jpeg',      'IMAGE'],
  ['image/png',       'IMAGE'],
  ['video/mp4',       'VIDEO'],
  ['video/3gpp',      'VIDEO'],
  ['application/pdf', 'DOCUMENT'],
]);

export const MAX_FILENAME_LEN      = 200;
export const FALLBACK_DOC_FILENAME = 'document.pdf';

/**
 * Sanitiza o filename de um asset DOCUMENT (ou qualquer display filename).
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
export function sanitizeFilename(raw) {
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
