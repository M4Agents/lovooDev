// =============================================================================
// Gravador de diagnóstico Meta — DEV only, envio BLOQUEADO.
// Não chama Graph, S3, chatApi, metaWhatsAppApi.send* nem sendAudioMessage.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import { useAudioRecorder } from '../../../hooks/useAudioRecorder'
import { AudioPreviewBar } from '../ChatArea/AudioPreviewBar'
import {
  META_AUDIO_DIAGNOSTIC_MAX_SECONDS,
  analyzeAudioBlob,
  isMediaRecorderTypeSupported,
  probeMediaRecorderSupport,
  selectSupportedMp4MimeType,
  type MetaAudioBlobAnalysis,
} from '../../../utils/metaAudioRecorderDiagnostic'
import {
  blobReadErrorValidation,
  readDiagnosticBlobBytes,
  validateDiagnosticAudioBytes,
  type DiagnosticOutboundValidation,
} from '../../../utils/metaOutboundAudioValidation'

export type MetaAudioDiagnosticMode = 'auto' | 'mp4'

export interface MetaAudioDiagnosticRecorderProps {
  conversationId: string
  disabled: boolean
}

function micErrorMessage(code: string | null): string | null {
  if (code === 'permission_denied') {
    return 'Permissão de microfone negada. Autorize o microfone neste navegador para gravar.'
  }
  if (code === 'unavailable') {
    return 'Nenhum microfone foi encontrado neste dispositivo.'
  }
  if (code === 'unknown') {
    return 'Não foi possível iniciar a gravação de áudio.'
  }
  return null
}

function recorderErrorMessage(code: string | null): string | null {
  if (code === 'unsupported_mime') {
    return 'Este navegador não declara suporte ao MIME MP4 pedido. Use o modo automático.'
  }
  if (code === 'start_failed') {
    return 'Falha ao iniciar o MediaRecorder com o formato solicitado.'
  }
  if (code === 'stop_failed') {
    return 'Falha ao encerrar a gravação. A prévia pode estar incompleta.'
  }
  return null
}

function formatSupported(value: boolean | null): string {
  if (value === true) return 'sim'
  if (value === false) return 'não'
  return 'n/d'
}

export function MetaAudioDiagnosticRecorder({
  conversationId,
  disabled,
}: MetaAudioDiagnosticRecorderProps) {
  const {
    isRecording,
    recordingSeconds,
    audioBlobPreview,
    audioPreviewUrl,
    audioMimeType,
    previewDurationSeconds,
    micError,
    recorderError,
    startRecording,
    stopRecording,
    cancelRecording,
    clearPreview,
  } = useAudioRecorder()

  const [mode, setMode] = useState<MetaAudioDiagnosticMode>('auto')
  const [analysis, setAnalysis] = useState<MetaAudioBlobAnalysis | null>(null)
  const [validation, setValidation] = useState<DiagnosticOutboundValidation | null>(null)
  const [requestedMime, setRequestedMime] = useState<string | null>(null)
  const [playback, setPlayback] = useState<'n/d' | 'ok' | 'error'>('n/d')
  const supported = probeMediaRecorderSupport()
  const mp4Mime = selectSupportedMp4MimeType()

  useEffect(() => {
    cancelRecording()
    clearPreview()
    setAnalysis(null)
    setValidation(null)
    setRequestedMime(null)
    setPlayback('n/d')
  }, [conversationId, cancelRecording, clearPreview])

  useEffect(() => {
    cancelRecording()
    clearPreview()
    setAnalysis(null)
    setValidation(null)
    setRequestedMime(null)
    setPlayback('n/d')
  }, [mode, cancelRecording, clearPreview])

  useEffect(() => {
    if (isRecording && recordingSeconds >= META_AUDIO_DIAGNOSTIC_MAX_SECONDS) {
      stopRecording()
    }
  }, [isRecording, recordingSeconds, stopRecording])

  useEffect(() => {
    if (!audioBlobPreview) {
      setAnalysis(null)
      setValidation(null)
      return
    }
    let cancelled = false
    setValidation(null)
    void (async () => {
      const buffer = await readDiagnosticBlobBytes(audioBlobPreview)
      if (cancelled) return
      if (!buffer) {
        setAnalysis(null)
        setValidation(blobReadErrorValidation())
        return
      }
      setAnalysis(analyzeAudioBlob(
        audioBlobPreview,
        audioMimeType,
        previewDurationSeconds,
        buffer,
      ))
      const result = await validateDiagnosticAudioBytes(new Uint8Array(buffer))
      if (cancelled) return
      setValidation(result)
    })()
    return () => { cancelled = true }
  }, [audioBlobPreview, audioMimeType, previewDurationSeconds])

  const handleToggle = useCallback(async () => {
    if (disabled) return
    if (isRecording) {
      stopRecording()
      return
    }
    if (mode === 'mp4') {
      if (!mp4Mime) return
      setRequestedMime(mp4Mime)
      await startRecording({ mimeType: mp4Mime })
      return
    }
    setRequestedMime(null)
    await startRecording()
  }, [disabled, isRecording, mode, mp4Mime, startRecording, stopRecording])

  const permissionText = micErrorMessage(micError)
  const recorderText = recorderErrorMessage(recorderError)
  const remaining = Math.max(0, META_AUDIO_DIAGNOSTIC_MAX_SECONDS - recordingSeconds)
  const requestedSupported = requestedMime
    ? isMediaRecorderTypeSupported(requestedMime)
    : null

  return (
    <div className="mb-2" data-testid="meta-audio-diagnostic-root">
      <p
        data-testid="meta-audio-send-blocked-notice"
        className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2"
      >
        Diagnóstico de áudio — envio ainda indisponível.
      </p>

      <fieldset className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600" data-testid="meta-audio-format-selector">
        <legend className="sr-only">Formato de gravação diagnóstica</legend>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="meta-audio-format"
            value="auto"
            checked={mode === 'auto'}
            disabled={isRecording}
            onChange={() => setMode('auto')}
            data-testid="meta-audio-mode-auto"
          />
          Automático (WebM atual)
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="radio"
            name="meta-audio-format"
            value="mp4"
            checked={mode === 'mp4'}
            disabled={isRecording || !mp4Mime}
            onChange={() => setMode('mp4')}
            data-testid="meta-audio-mode-mp4"
          />
          MP4 experimental
        </label>
      </fieldset>

      {!mp4Mime && (
        <p data-testid="meta-audio-mp4-unsupported" className="text-xs text-slate-500 mb-2">
          Este navegador não declara suporte a audio/mp4. O modo MP4 permanece desligado. isTypeSupported não prova AAC.
        </p>
      )}

      {permissionText && (
        <p role="alert" data-testid="meta-audio-mic-error" className="text-xs text-red-600 mb-2">
          {permissionText}
        </p>
      )}
      {recorderText && (
        <p role="alert" data-testid="meta-audio-recorder-error" className="text-xs text-red-600 mb-2">
          {recorderText}
        </p>
      )}

      {isRecording && (
        <div
          data-testid="meta-audio-recording-bar"
          className="flex items-center gap-2 mb-2 text-sm text-red-700"
        >
          <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          <span>Gravando {recordingSeconds}s (máx. {META_AUDIO_DIAGNOSTIC_MAX_SECONDS}s, restam {remaining}s)</span>
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-lg border border-red-200 px-2 py-1 text-xs"
          >
            Encerrar
          </button>
          <button
            type="button"
            onClick={cancelRecording}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600"
          >
            Cancelar
          </button>
        </div>
      )}

      {audioBlobPreview && audioPreviewUrl && (
        <div data-testid="meta-audio-preview">
          <AudioPreviewBar
            audioUrl={audioPreviewUrl}
            durationSeconds={previewDurationSeconds}
            isSending={false}
            showSendButton={false}
            onCancel={clearPreview}
            onPlaybackCanPlay={() => setPlayback('ok')}
            onPlaybackError={() => setPlayback('error')}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={disabled || !!audioBlobPreview || (mode === 'mp4' && !mp4Mime)}
          data-testid="meta-audio-mic-button"
          aria-label={isRecording ? 'Encerrar gravação' : 'Gravar áudio (diagnóstico)'}
          title={isRecording ? 'Encerrar gravação' : 'Gravar áudio (diagnóstico DEV)'}
          className={`flex-shrink-0 rounded-xl border px-3 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isRecording
              ? 'border-red-300 text-red-600 bg-red-50'
              : 'border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-300'
          }`}
        >
          <Mic className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      <dl
        data-testid="meta-audio-diagnostic-panel"
        className="mt-2 grid grid-cols-1 gap-0.5 text-[11px] text-slate-500 leading-snug"
      >
        <div>WebM: {formatSupported(supported['audio/webm'])} · OGG: {formatSupported(supported['audio/ogg'])} · OGG Opus: {formatSupported(supported['audio/ogg;codecs=opus'])} · MP4: {formatSupported(supported['audio/mp4'])} · MP4 AAC: {formatSupported(supported['audio/mp4;codecs=mp4a.40.2'])}</div>
        <div>Modo solicitado: {mode === 'mp4' ? 'MP4 experimental' : 'automático / WebM atual'}</div>
        {analysis ? (
          <>
            <div>MIME solicitado: {requestedMime || 'automático (ordem do gravador)'}</div>
            <div>isTypeSupported(solicitado): {requestedMime ? formatSupported(requestedSupported) : 'n/d'}</div>
            <div>MIME gravador: {analysis.recorderMimeType || 'n/d'}</div>
            <div>MIME do Blob: {analysis.blobMimeType || 'n/d'}</div>
            <div>Tamanho: {analysis.sizeBytes} bytes · Duração: {analysis.durationSeconds}s</div>
            <div>Assinatura: {analysis.byteSignature || 'n/d'}</div>
            <div>Contêiner: {analysis.container}</div>
            <div>{analysis.containerNote}</div>
            {analysis.mimeContainerMismatch && (
              <div data-testid="meta-audio-mime-mismatch">
                MIME declarado e assinatura divergem — não tratar como MP4 válido.
              </div>
            )}
            <div>Reprodução local: {playback === 'ok' ? 'ok' : playback === 'error' ? 'falhou' : 'não observada'}</div>
            <div>Meta: {analysis.metaAcceptance}</div>
            <div data-testid="meta-audio-b31-validation">
              Validador B3.1: {validation ? validation.label : 'analisando bytes...'}
            </div>
            <div>Envio à Meta permanece bloqueado nesta etapa. Áudio não é salvo nem enviado.</div>
          </>
        ) : validation ? (
          <div data-testid="meta-audio-b31-validation">
            Validador B3.1: {validation.label}
          </div>
        ) : audioBlobPreview ? (
          <div data-testid="meta-audio-b31-validation">Validador B3.1: analisando bytes...</div>
        ) : (
          <div>Grave um áudio para inspecionar MIME, tamanho e contêiner (permanece neste navegador).</div>
        )}
      </dl>
    </div>
  )
}
