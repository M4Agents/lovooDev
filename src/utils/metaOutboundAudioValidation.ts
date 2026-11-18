// =============================================================================
// Validação B3.1 no diagnóstico Meta — somente DEV.
//
// Reutiliza validateMetaOutboundAudioBytes via import dinâmico para não
// inflar o bundle de produção nem criar endpoint de diagnóstico.
// Bytes permanecem no navegador: sem Graph, S3, banco ou download.
// =============================================================================

import { isMetaAudioRecorderDiagnosticEnabled } from './metaAudioRecorderDiagnostic'

export type DiagnosticOutboundValidationStatus =
  | 'aac_lc'
  | 'unconfirmed'
  | 'rejected'
  | 'read_error'
  | 'skipped'

export interface DiagnosticOutboundValidation {
  status: DiagnosticOutboundValidationStatus
  label: string
  code: string | null
  reason: string | null
  audioCodec: 'aac' | 'unconfirmed' | null
  aacProfile: 'lc' | null
}

type MetaOutboundAudioBytesResult = {
  ok: true
  container: 'mp4'
  sampleEntry: 'mp4a'
  hasAudio: true
  hasVideo: false
  audioCodec: 'aac' | 'unconfirmed'
  aacProfile: 'lc' | null
} | {
  ok: false
  code: string
  reason: string
}

async function loadOutboundAudioValidator() {
  const mod = await import('../../api/lib/meta-whatsapp/audioBytes.js')
  return mod.validateMetaOutboundAudioBytes
}

export function summarizeOutboundAudioValidation(
  result: MetaOutboundAudioBytesResult,
): DiagnosticOutboundValidation {
  if (!result.ok) {
    return {
      status: 'rejected',
      label: `rejeitado — ${result.reason}`,
      code: result.code,
      reason: result.reason,
      audioCodec: null,
      aacProfile: null,
    }
  }

  if (result.audioCodec === 'aac' && result.aacProfile === 'lc') {
    return {
      status: 'aac_lc',
      label: 'AAC-LC confirmado',
      code: null,
      reason: null,
      audioCodec: 'aac',
      aacProfile: 'lc',
    }
  }

  return {
    status: 'unconfirmed',
    label: 'inconclusivo',
    code: null,
    reason: result.audioCodec === 'aac' ? 'aac_without_lc_profile' : 'mp4a_without_esds',
    audioCodec: result.audioCodec,
    aacProfile: result.aacProfile,
  }
}

export function skippedDiagnosticValidation(): DiagnosticOutboundValidation {
  return {
    status: 'skipped',
    label: 'Validador B3.1 não executado fora do diagnóstico DEV.',
    code: null,
    reason: 'diagnostic_disabled',
    audioCodec: null,
    aacProfile: null,
  }
}

export function blobReadErrorValidation(): DiagnosticOutboundValidation {
  return {
    status: 'read_error',
    label: 'Erro ao ler o Blob gravado.',
    code: 'invalid_audio_input',
    reason: 'blob_read_failed',
    audioCodec: null,
    aacProfile: null,
  }
}

export function readDiagnosticBlobBytes(blob: Blob): Promise<ArrayBuffer | null> {
  const withArrayBuffer = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
  if (typeof withArrayBuffer.arrayBuffer === 'function') {
    return withArrayBuffer.arrayBuffer().catch(() => null)
  }
  return new Promise((resolve) => {
    try {
      const reader = new FileReader()
      reader.onload = () => {
        resolve(reader.result instanceof ArrayBuffer ? reader.result : null)
      }
      reader.onerror = () => resolve(null)
      reader.readAsArrayBuffer(blob)
    } catch {
      resolve(null)
    }
  })
}

export async function validateDiagnosticAudioBytes(
  bytes: Uint8Array,
  hostname?: string,
): Promise<DiagnosticOutboundValidation> {
  if (!isMetaAudioRecorderDiagnosticEnabled(hostname)) {
    return skippedDiagnosticValidation()
  }
  const validate = await loadOutboundAudioValidator()
  return summarizeOutboundAudioValidation(validate(bytes))
}

export async function validateDiagnosticAudioBlob(
  blob: Blob,
  hostname?: string,
): Promise<DiagnosticOutboundValidation> {
  if (!isMetaAudioRecorderDiagnosticEnabled(hostname)) {
    return skippedDiagnosticValidation()
  }
  const buffer = await readDiagnosticBlobBytes(blob)
  if (!buffer) return blobReadErrorValidation()
  return validateDiagnosticAudioBytes(new Uint8Array(buffer), hostname)
}
