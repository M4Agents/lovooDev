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
  probeMediaRecorderSupport,
  type MetaAudioBlobAnalysis,
} from '../../../utils/metaAudioRecorderDiagnostic'

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

function formatSupported(value: boolean | null): string {
  if (value === true) return 'sim'
  if (value === false) return 'não'
  return 'n/d'
}

function readBlobBytes(blob: Blob): Promise<ArrayBuffer | null> {
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
    startRecording,
    stopRecording,
    cancelRecording,
    clearPreview,
  } = useAudioRecorder()

  const [analysis, setAnalysis] = useState<MetaAudioBlobAnalysis | null>(null)
  const supported = probeMediaRecorderSupport()

  useEffect(() => {
    cancelRecording()
    clearPreview()
    setAnalysis(null)
  }, [conversationId, cancelRecording, clearPreview])

  useEffect(() => {
    if (isRecording && recordingSeconds >= META_AUDIO_DIAGNOSTIC_MAX_SECONDS) {
      stopRecording()
    }
  }, [isRecording, recordingSeconds, stopRecording])

  useEffect(() => {
    if (!audioBlobPreview) {
      setAnalysis(null)
      return
    }
    let cancelled = false
    void readBlobBytes(audioBlobPreview).then((buffer) => {
      if (cancelled || !buffer) return
      setAnalysis(analyzeAudioBlob(
        audioBlobPreview,
        audioMimeType,
        previewDurationSeconds,
        buffer,
      ))
    })
    return () => { cancelled = true }
  }, [audioBlobPreview, audioMimeType, previewDurationSeconds])

  const handleToggle = useCallback(async () => {
    if (disabled) return
    if (isRecording) {
      stopRecording()
      return
    }
    await startRecording()
  }, [disabled, isRecording, startRecording, stopRecording])

  const permissionText = micErrorMessage(micError)
  const remaining = Math.max(0, META_AUDIO_DIAGNOSTIC_MAX_SECONDS - recordingSeconds)

  return (
    <div className="mb-2" data-testid="meta-audio-diagnostic-root">
      <p
        data-testid="meta-audio-send-blocked-notice"
        className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2"
      >
        Diagnóstico de áudio — envio ainda indisponível.
      </p>

      {permissionText && (
        <p role="alert" data-testid="meta-audio-mic-error" className="text-xs text-red-600 mb-2">
          {permissionText}
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
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleToggle()}
          disabled={disabled || !!audioBlobPreview}
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
        <div>WebM: {formatSupported(supported['audio/webm'])} · OGG: {formatSupported(supported['audio/ogg'])} · OGG Opus: {formatSupported(supported['audio/ogg;codecs=opus'])} · MP4: {formatSupported(supported['audio/mp4'])}</div>
        {analysis ? (
          <>
            <div>MIME gravador: {analysis.recorderMimeType || 'n/d'}</div>
            <div>MIME do Blob: {analysis.blobMimeType || 'n/d'}</div>
            <div>Tamanho: {analysis.sizeBytes} bytes · Duração: {analysis.durationSeconds}s</div>
            <div>Contêiner: {analysis.container}</div>
            <div>{analysis.containerNote}</div>
            <div>Meta: {analysis.metaAcceptance}</div>
            <div>Codec: não confirmado</div>
          </>
        ) : (
          <div>Grave um áudio para inspecionar MIME, tamanho e contêiner (permanece neste navegador).</div>
        )}
      </dl>
    </div>
  )
}
