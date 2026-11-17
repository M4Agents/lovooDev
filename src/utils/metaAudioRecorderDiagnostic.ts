// =============================================================================
// Diagnóstico local de áudio Meta — somente UI DEV.
//
// Não envia Blob, não chama Graph, S3 ou Supabase.
// Gate visual por hostname EXATO (allowlist). Sem flag de ambiente.
// app.lovoocrm.com e qualquer host fora da lista permanecem bloqueados.
// Não é autorização de dados, RBAC, company_id ou RLS.
// =============================================================================

export const META_AUDIO_DIAGNOSTIC_ALLOWED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '::1',
  'lovoo-dev.vercel.app',
] as const

export const META_AUDIO_DIAGNOSTIC_BLOCKED_HOSTS = [
  'app.lovoocrm.com',
] as const

export const META_AUDIO_DIAGNOSTIC_MAX_SECONDS = 180

const MIME_PROBE_LIST = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
] as const

export type MetaAudioContainerGuess =
  | 'webm_or_ebml'
  | 'ogg'
  | 'mp4_iso_bmff'
  | 'mpeg_or_id3'
  | 'unknown'
  | 'empty'

export interface MetaAudioSupportedTypes {
  'audio/webm': boolean | null
  'audio/webm;codecs=opus': boolean | null
  'audio/ogg': boolean | null
  'audio/ogg;codecs=opus': boolean | null
  'audio/mp4': boolean | null
  'audio/mpeg': boolean | null
}

export interface MetaAudioBlobAnalysis {
  recorderMimeType: string | null
  blobMimeType: string
  sizeBytes: number
  durationSeconds: number
  container: MetaAudioContainerGuess
  containerNote: string
  metaAcceptance: string
  codecConfirmed: false
}

export function normalizeDiagnosticHostname(hostname: string): string | null {
  if (typeof hostname !== 'string') return null
  let host = hostname.trim().toLowerCase()
  if (!host) return null
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (!host) return null
  if (/[\s/?#@\\]/.test(host)) return null
  if (host.includes(':') && host !== '::1') return null
  return host
}

export function isMetaAudioRecorderDiagnosticEnabled(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
): boolean {
  const host = normalizeDiagnosticHostname(hostname)
  if (!host) return false
  if ((META_AUDIO_DIAGNOSTIC_BLOCKED_HOSTS as readonly string[]).includes(host)) {
    return false
  }
  return (META_AUDIO_DIAGNOSTIC_ALLOWED_HOSTS as readonly string[]).includes(host)
}

export function probeMediaRecorderSupport(): MetaAudioSupportedTypes {
  const empty: MetaAudioSupportedTypes = {
    'audio/webm': null,
    'audio/webm;codecs=opus': null,
    'audio/ogg': null,
    'audio/ogg;codecs=opus': null,
    'audio/mp4': null,
    'audio/mpeg': null,
  }
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return empty
  }
  const result = { ...empty }
  for (const mime of MIME_PROBE_LIST) {
    try {
      result[mime] = MediaRecorder.isTypeSupported(mime)
    } catch {
      result[mime] = null
    }
  }
  return result
}

export function guessAudioContainer(bytes: Uint8Array): {
  container: MetaAudioContainerGuess
  note: string
} {
  if (!bytes || bytes.length === 0) {
    return { container: 'empty', note: 'Sem bytes para inspecionar.' }
  }
  if (bytes.length < 8) {
    return { container: 'unknown', note: 'Amostra curta demais para identificar o contêiner.' }
  }
  const ascii = (start: number, n: number) =>
    String.fromCharCode(...bytes.slice(start, start + n))

  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return {
      container: 'webm_or_ebml',
      note: 'Assinatura EBML (WebM/Matroska). Codec não confirmado. WebM não consta na allowlist de áudio da Meta.',
    }
  }
  if (ascii(0, 4) === 'OggS') {
    return {
      container: 'ogg',
      note: 'Contêiner Ogg (OggS). Codec Opus NÃO foi confirmado — OggS não prova Opus.',
    }
  }
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    return {
      container: 'mp4_iso_bmff',
      note: `ISO-BMFF (ftyp${brand ? `/${brand}` : ''}). Pode ser áudio M4A ou vídeo. Não afirmar que é só áudio.`,
    }
  }
  if (ascii(0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return {
      container: 'mpeg_or_id3',
      note: 'Possível MPEG/MP3 (ID3 ou frame). Codec não inspecionado além da assinatura.',
    }
  }
  return { container: 'unknown', note: 'Assinatura de contêiner não reconhecida.' }
}

export function describeMetaAcceptance(container: MetaAudioContainerGuess): string {
  switch (container) {
    case 'webm_or_ebml':
      return 'Provavelmente rejeitado pela Meta (WebM não listado para áudio).'
    case 'ogg':
      return 'Possivelmente aceito se o codec for Opus (não confirmado nesta etapa).'
    case 'mp4_iso_bmff':
      return 'Possivelmente aceito como áudio básico se for M4A (não confirmado; ftyp também serve para vídeo).'
    case 'mpeg_or_id3':
      return 'Possivelmente aceito como áudio básico (audio/mpeg), se a assinatura corresponder a MP3.'
    default:
      return 'Compatibilidade com a Meta indeterminada.'
  }
}

export function analyzeAudioBlob(
  blob: Blob,
  recorderMimeType: string | null,
  durationSeconds: number,
  bytes: ArrayBuffer,
): MetaAudioBlobAnalysis {
  const view = new Uint8Array(bytes)
  const guessed = guessAudioContainer(view)
  return {
    recorderMimeType,
    blobMimeType: blob.type || '',
    sizeBytes: blob.size,
    durationSeconds,
    container: guessed.container,
    containerNote: guessed.note,
    metaAcceptance: describeMetaAcceptance(guessed.container),
    codecConfirmed: false,
  }
}
