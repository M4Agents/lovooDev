// =============================================================================
// Preparação local do envio de áudio Meta.
// Valida AAC-LC MP4, congela bytes e classifica HTTP.
// Não chama Graph, S3 ou banco. Não gera operation_id em retry.
// =============================================================================

import {
  META_OUTBOUND_AUDIO_MAX_BYTES,
  validateMetaOutboundAudioBytes,
} from '../../api/lib/meta-whatsapp/audioBytes.js'

export const META_OUTBOUND_AUDIO_FILENAME = 'audio.m4a'
export const META_OUTBOUND_AUDIO_MIME = 'audio/mp4'
export const META_OUTBOUND_OPERATION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type MetaAudioSendUiKind =
  | 'success'
  | 'not_enabled'
  | 'recoverable'
  | 'blocked'
  | 'error'

export interface MetaAudioSendClassification {
  kind: MetaAudioSendUiKind
  code: string
  keepDraft: boolean
  allowRecover: boolean
  allowNewOperation: boolean
}

const RECOVERABLE_CODES = new Set([
  'persist_deadline_insufficient',
  'graph_deadline_insufficient',
  'send_persistence_failed',
  'network_error',
  'internal_error',
])

const BLOCKED_CODES = new Set([
  'operation_unknown',
  'operation_in_progress',
  'graph_in_flight',
])

export function mintOutboundAudioOperationId(): string {
  return crypto.randomUUID().toLowerCase()
}

export function isOutboundAudioOperationId(value: string): boolean {
  return META_OUTBOUND_OPERATION_ID_RE.test(value)
}

export function freezeOutboundAudioFile(bytes: Uint8Array): File {
  const copy = bytes.slice()
  return new File([copy], META_OUTBOUND_AUDIO_FILENAME, {
    type: META_OUTBOUND_AUDIO_MIME,
  })
}

export function validateOutboundAudioBytesForSend(bytes: Uint8Array): {
  ok: boolean
  code: string | null
} {
  if (bytes.byteLength > META_OUTBOUND_AUDIO_MAX_BYTES) {
    return { ok: false, code: 'audio_too_large' }
  }
  const result = validateMetaOutboundAudioBytes(bytes)
  if (result.ok === true && result.audioCodec === 'aac' && result.aacProfile === 'lc') {
    return { ok: true, code: null }
  }
  if (!result.ok && result.code === 'audio_too_large') {
    return { ok: false, code: 'audio_too_large' }
  }
  return { ok: false, code: 'invalid_audio' }
}

export function classifyMetaOutboundAudioSend(status: number, code: string): MetaAudioSendClassification {
  if (status >= 200 && status < 300 && code === 'ok') {
    return {
      kind: 'success',
      code: 'ok',
      keepDraft: false,
      allowRecover: false,
      allowNewOperation: false,
    }
  }
  if (status === 501 || code === 'audio_send_not_enabled') {
    return {
      kind: 'not_enabled',
      code: 'audio_send_not_enabled',
      keepDraft: true,
      allowRecover: false,
      allowNewOperation: false,
    }
  }
  if (BLOCKED_CODES.has(code)) {
    return {
      kind: 'blocked',
      code,
      keepDraft: true,
      allowRecover: false,
      allowNewOperation: false,
    }
  }
  if (status === 0 || status === 503 || RECOVERABLE_CODES.has(code)) {
    return {
      kind: 'recoverable',
      code: code || 'network_error',
      keepDraft: true,
      allowRecover: true,
      allowNewOperation: false,
    }
  }
  return {
    kind: 'error',
    code: code || 'internal_error',
    keepDraft: true,
    allowRecover: false,
    allowNewOperation: code === 'invalid_audio' || code === 'audio_too_large',
  }
}

export function messageForMetaAudioSend(kind: MetaAudioSendUiKind, code: string): string {
  switch (kind) {
    case 'not_enabled':
      return 'Envio de áudio Meta ainda indisponível'
    case 'recoverable':
      if (code === 'send_persistence_failed' || code === 'persist_deadline_insufficient') {
        return 'O áudio pode já ter sido enviado. Recupere o registro com a mesma gravação.'
      }
      return 'Não foi possível confirmar o envio. Recupere com a mesma gravação.'
    case 'blocked':
      if (code === 'operation_unknown') {
        return 'Este envio ficou indefinido. Verifique a conversa. Não envie de novo.'
      }
      return 'Este envio ainda está em andamento. Verifique a conversa. Não envie de novo.'
    case 'error':
      if (code === 'audio_too_large') return 'O áudio excede o limite de 4 MiB.'
      if (code === 'invalid_audio') return 'Este áudio não é MP4 AAC-LC e não pode ser enviado.'
      if (code === 'audio_remux_failed') {
        return 'Não foi possível preparar o áudio para envio. Grave novamente.'
      }
      if (code === 'instance_not_connected') return 'A instância não está conectada.'
      if (code === 'operation_conflict') return 'Esta gravação conflita com um envio já registrado.'
      return 'Não foi possível enviar o áudio.'
    default:
      return 'Áudio enviado.'
  }
}
