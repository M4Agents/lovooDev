// ─────────────────────────────────────────────────────────────────────────────
// audioTranscriber.js
//
// Utilitário de transcrição de áudio via OpenAI Whisper-1.
// Projetado para uso em fluxos críticos (webhooks): nunca lança erro,
// nunca loga conteúdo transcrito nem URLs sensíveis.
// ─────────────────────────────────────────────────────────────────────────────

import { toFile }           from 'openai';
import { getOpenAIClient }  from './client.js';

// ── Constantes ────────────────────────────────────────────────────────────────

const WHISPER_MODEL    = 'whisper-1';
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB (limite seguro para Whisper)

const MIME_TO_EXT = {
  'audio/ogg':    'ogg',
  'audio/opus':   'ogg',
  'audio/mpeg':   'mp3',
  'audio/mp3':    'mp3',
  'audio/mp4':    'mp4',
  'audio/wav':    'wav',
  'audio/x-wav':  'wav',
  'audio/webm':   'webm',
  'video/ogg':    'ogg',   // alguns browsers reportam ogg com mime video
  'video/webm':   'webm',
};

function mimeToExt(mimeType) {
  if (!mimeType) return 'ogg';
  const base = String(mimeType).split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] ?? 'ogg';
}

// ── Função principal ──────────────────────────────────────────────────────────

/**
 * Transcreve um buffer de áudio usando Whisper-1.
 *
 * @param {Buffer}  buffer   – conteúdo do arquivo de áudio já descriptografado
 * @param {string}  mimeType – ex: 'audio/ogg', 'audio/mpeg'
 * @param {object}  options
 * @param {number}  options.timeoutMs – timeout hard em ms (default 6000)
 * @param {string}  options.language  – idioma para Whisper (default 'pt')
 *
 * @returns {Promise<string|null>} texto transcrito ou null em caso de falha
 */
export async function transcribeAudioBuffer(buffer, mimeType, { timeoutMs = 6000, language = 'pt' } = {}) {
  const start = Date.now();

  // ── Guardrails ──────────────────────────────────────────────────────────────

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    console.warn('[AUDIO_TRANSCRIPTION] invalid or empty buffer', { size: buffer?.length ?? 0 });
    return null;
  }

  if (buffer.length > MAX_BUFFER_BYTES) {
    console.warn('[AUDIO_TRANSCRIPTION] buffer exceeds limit', {
      size_bytes: buffer.length,
      limit_bytes: MAX_BUFFER_BYTES,
    });
    return null;
  }

  const client = getOpenAIClient();
  if (!client) {
    console.warn('[AUDIO_TRANSCRIPTION] OpenAI client unavailable');
    return null;
  }

  // ── Transcrição ─────────────────────────────────────────────────────────────

  try {
    const ext      = mimeToExt(mimeType);
    const safeMime = mimeType || 'audio/ogg';

    // Blob é suportado no Node.js 18+ (runtime Vercel)
    const blob = new Blob([buffer], { type: safeMime });
    const file = await toFile(blob, `audio.${ext}`, { type: safeMime });

    const transcriptionPromise = client.audio.transcriptions.create({
      file,
      model:    WHISPER_MODEL,
      language,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('transcription_timeout')), timeoutMs)
    );

    const result     = await Promise.race([transcriptionPromise, timeoutPromise]);
    const transcript = result.text?.trim() || null;
    const elapsed    = Date.now() - start;

    console.info('[AUDIO_TRANSCRIPTION] success', {
      elapsed_ms:       elapsed,
      buffer_bytes:     buffer.length,
      transcript_chars: transcript?.length ?? 0,
    });

    return transcript || null;

  } catch (err) {
    const elapsed   = Date.now() - start;
    const isTimeout = err.message === 'transcription_timeout';

    console.warn('[AUDIO_TRANSCRIPTION] failed', {
      reason:     isTimeout ? 'timeout' : 'error',
      elapsed_ms: elapsed,
      ...(isTimeout ? {} : { error: err.message }),
    });

    return null;
  }
}
