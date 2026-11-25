// =============================================================================
// Compositor de áudio Meta — gravação MP4 AAC-LC e envio idempotente.
// Reutiliza useAudioRecorder e AudioPreviewBar. Sem Uazapi, Graph ou S3 no UI.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'
import { useAudioRecorder } from '../../../hooks/useAudioRecorder'
import { AudioPreviewBar } from '../ChatArea/AudioPreviewBar'
import {
  META_AUDIO_DIAGNOSTIC_MAX_SECONDS,
  selectSupportedMp4MimeType,
} from '../../../utils/metaAudioRecorderDiagnostic'
import { readDiagnosticBlobBytes } from '../../../utils/metaOutboundAudioValidation'
import {
  classifyMetaOutboundAudioSend,
  freezeOutboundAudioFile,
  messageForMetaAudioSend,
  mintOutboundAudioOperationId,
  type MetaAudioSendUiKind,
  validateOutboundAudioBytesForSend,
} from '../../../utils/metaOutboundAudioSend'
import {
  metaWhatsAppApi,
  MetaOutboundAudioSendError,
} from '../../../services/metaWhatsAppApi'

export type MetaOutboundAudioPhase =
  | 'idle'
  | 'recording'
  | 'preview'
  | 'sending'
  | 'not_enabled'
  | 'recoverable'
  | 'blocked'
  | 'error'

export interface MetaOutboundAudioComposerProps {
  companyId: string
  instanceId: string | undefined
  conversationId: string
  sessionAllowed?: boolean
  onSent: () => void
}

function micErrorMessage(code: string | null): string | null {
  if (code === 'permission_denied') {
    return 'Permissão de microfone negada. Autorize o microfone neste navegador.'
  }
  if (code === 'unavailable') return 'Nenhum microfone foi encontrado neste dispositivo.'
  if (code === 'unknown') return 'Não foi possível iniciar a gravação de áudio.'
  return null
}

function recorderErrorMessage(code: string | null): string | null {
  if (code === 'unsupported_mime') {
    return 'Este navegador não grava MP4 AAC-LC. O envio de áudio permanece indisponível.'
  }
  if (code === 'start_failed') return 'Falha ao iniciar a gravação.'
  if (code === 'stop_failed') return 'Falha ao encerrar a gravação.'
  return null
}

export function MetaOutboundAudioComposer({
  companyId,
  instanceId,
  conversationId,
  sessionAllowed = true,
  onSent,
}: MetaOutboundAudioComposerProps) {
  const {
    isRecording,
    recordingSeconds,
    audioBlobPreview,
    audioPreviewUrl,
    previewDurationSeconds,
    micError,
    recorderError,
    startRecording,
    stopRecording,
    cancelRecording,
    clearPreview,
  } = useAudioRecorder()

  const [phase, setPhase] = useState<MetaOutboundAudioPhase>('idle')
  const [statusKind, setStatusKind] = useState<MetaAudioSendUiKind | null>(null)
  const [statusCode, setStatusCode] = useState<string | null>(null)
  const [eligible, setEligible] = useState(false)
  const mp4Mime = selectSupportedMp4MimeType()
  const canUseMic = Boolean(mp4Mime) && Boolean(instanceId) && sessionAllowed

  useEffect(() => {
    if (sessionAllowed || !isRecording) return
    stopRecording()
  }, [isRecording, sessionAllowed, stopRecording])

  const sendingRef = useRef(false)
  const mountedRef = useRef(true)
  const operationIdRef = useRef<string | null>(null)
  const frozenFileRef = useRef<File | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const resetDraft = useCallback(() => {
    operationIdRef.current = null
    frozenFileRef.current = null
    setEligible(false)
    setStatusKind(null)
    setStatusCode(null)
    setPhase('idle')
    cancelRecording()
    clearPreview()
  }, [cancelRecording, clearPreview])

  useEffect(() => {
    resetDraft()
  }, [conversationId, resetDraft])

  useEffect(() => {
    if (isRecording && recordingSeconds >= META_AUDIO_DIAGNOSTIC_MAX_SECONDS) {
      stopRecording()
    }
  }, [isRecording, recordingSeconds, stopRecording])

  useEffect(() => {
    if (isRecording) {
      setPhase('recording')
      setStatusKind(null)
      setStatusCode(null)
    }
  }, [isRecording])

  useEffect(() => {
    if (!audioBlobPreview) {
      setEligible(false)
      return
    }
    if (frozenFileRef.current) {
      setEligible(true)
      return
    }
    let cancelled = false
    void (async () => {
      const buffer = await readDiagnosticBlobBytes(audioBlobPreview)
      if (cancelled || !mountedRef.current) return
      if (!buffer) {
        setEligible(false)
        setPhase('error')
        setStatusKind('error')
        setStatusCode('invalid_audio')
        return
      }
      const { remuxMetaOutboundAudioToProgressiveMp4 } = await import(
        '../../../utils/metaOutboundAudioRemux'
      )
      if (cancelled || !mountedRef.current) return
      const remuxed = await remuxMetaOutboundAudioToProgressiveMp4(new Uint8Array(buffer))
      if (cancelled || !mountedRef.current) return
      if (!remuxed.ok) {
        setEligible(false)
        setPhase('error')
        setStatusKind('error')
        setStatusCode(remuxed.code)
        return
      }
      const validation = validateOutboundAudioBytesForSend(remuxed.bytes)
      if (cancelled || !mountedRef.current) return
      if (!validation.ok) {
        setEligible(false)
        setPhase('error')
        setStatusKind('error')
        setStatusCode(validation.code)
        return
      }
      if (!operationIdRef.current) {
        operationIdRef.current = mintOutboundAudioOperationId()
      }
      if (!frozenFileRef.current) {
        frozenFileRef.current = freezeOutboundAudioFile(remuxed.bytes)
      }
      setEligible(true)
      setPhase((current) => (
        current === 'sending'
        || current === 'recoverable'
        || current === 'blocked'
        || current === 'not_enabled'
          ? current
          : 'preview'
      ))
    })()
    return () => { cancelled = true }
  }, [audioBlobPreview])

  const submit = useCallback(async () => {
    if (!sessionAllowed || sendingRef.current || !instanceId) return
    const operationId = operationIdRef.current
    const audio = frozenFileRef.current
    if (!operationId || !audio || !eligible) return

    sendingRef.current = true
    setPhase('sending')
    setStatusKind(null)
    setStatusCode(null)

    try {
      await metaWhatsAppApi.sendAudio({
        companyId,
        instanceId,
        conversationId,
        operationId,
        audio,
      })
      if (!mountedRef.current) return
      resetDraft()
      onSent()
    } catch (err) {
      if (!mountedRef.current) return
      const status = err instanceof MetaOutboundAudioSendError ? err.status : 0
      const code = err instanceof MetaOutboundAudioSendError ? err.code : 'network_error'
      const classified = classifyMetaOutboundAudioSend(status, code)
      setStatusKind(classified.kind)
      setStatusCode(classified.code)
      if (classified.kind === 'blocked') setPhase('blocked')
      else if (classified.kind === 'not_enabled') setPhase('not_enabled')
      else if (classified.kind === 'recoverable') setPhase('recoverable')
      else setPhase('error')
    } finally {
      sendingRef.current = false
    }
  }, [companyId, conversationId, eligible, instanceId, onSent, resetDraft, sessionAllowed])

  const handleMic = useCallback(async () => {
    if (!canUseMic || sendingRef.current) return
    if (isRecording) {
      stopRecording()
      return
    }
    if (audioBlobPreview || phase === 'recoverable' || phase === 'blocked' || phase === 'not_enabled') return
    await startRecording({ mimeType: mp4Mime! })
  }, [audioBlobPreview, canUseMic, isRecording, mp4Mime, phase, startRecording, stopRecording])

  const handleCancelPreview = useCallback(() => {
    if (phase === 'sending' || phase === 'recoverable' || phase === 'blocked') return
    resetDraft()
  }, [phase, resetDraft])

  const remaining = Math.max(0, META_AUDIO_DIAGNOSTIC_MAX_SECONDS - recordingSeconds)
  const permissionText = micErrorMessage(micError)
  const recorderText = recorderErrorMessage(recorderError)
  const statusText = statusKind && statusCode
    ? messageForMetaAudioSend(statusKind, statusCode)
    : recorderText || permissionText
  const showSend = eligible && (
    phase === 'preview' || phase === 'error' || phase === 'sending' || phase === 'not_enabled'
  )
  const showRecover = phase === 'recoverable'
  const lockCancel = phase === 'sending' || phase === 'recoverable' || phase === 'blocked'
  const statusClass =
    statusKind === 'not_enabled' ? 'text-amber-700'
      : statusKind === 'recoverable' ? 'text-amber-800'
        : statusKind === 'blocked' ? 'text-slate-700'
          : 'text-red-600'

  return (
    <div className="mb-2" data-testid="meta-outbound-audio-root" data-phase={phase}>
      {!mp4Mime && (
        <p data-testid="meta-outbound-audio-unavailable" className="text-[11px] text-slate-500 mb-2">
          Áudio indisponível neste navegador. É necessário gravar em MP4 AAC-LC.
        </p>
      )}

      {phase === 'sending' && (
        <p data-testid="meta-outbound-audio-sending" className="text-xs text-slate-600 mb-2 leading-relaxed">
          Enviando áudio...
        </p>
      )}

      {statusText && (
        <p
          role="alert"
          data-testid="meta-outbound-audio-error"
          data-kind={statusKind ?? 'local'}
          data-code={statusCode ?? undefined}
          className={`text-xs mb-2 leading-relaxed ${statusClass}`}
        >
          {statusText}
        </p>
      )}

      {isRecording && (
        <div
          data-testid="meta-outbound-audio-recording"
          className="flex items-center gap-2 mb-2 text-sm text-red-700"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span>Gravando {recordingSeconds}s (restam {remaining}s)</span>
          <button type="button" onClick={stopRecording} className="rounded-lg border border-red-200 px-2 py-1 text-xs">
            Encerrar
          </button>
          <button
            type="button"
            onClick={resetDraft}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
          >
            Cancelar
          </button>
        </div>
      )}

      {audioBlobPreview && audioPreviewUrl && (
        <div data-testid="meta-outbound-audio-preview">
          <AudioPreviewBar
            audioUrl={audioPreviewUrl}
            durationSeconds={previewDurationSeconds}
            isSending={phase === 'sending'}
            showSendButton={showSend}
            allowCancel={!lockCancel}
            onCancel={handleCancelPreview}
            onSend={showSend && sessionAllowed ? () => void submit() : undefined}
          />
          {showRecover && (
            <button
              type="button"
              data-testid="meta-outbound-audio-recover"
              disabled={!sessionAllowed}
              onClick={() => { if (sessionAllowed) void submit() }}
              className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Recuperar envio
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleMic()}
        disabled={!canUseMic || !!audioBlobPreview || phase === 'sending' || phase === 'recoverable' || phase === 'blocked' || phase === 'not_enabled'}
        data-testid="meta-outbound-audio-mic"
        data-session-allowed={sessionAllowed ? 'true' : 'false'}
        aria-label={isRecording ? 'Encerrar gravação' : 'Gravar áudio'}
        className={`flex-shrink-0 rounded-xl border px-3 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isRecording
            ? 'border-red-300 text-red-600 bg-red-50'
            : 'border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-300'
        }`}
      >
        <Mic className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  )
}
