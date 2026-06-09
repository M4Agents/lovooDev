// =====================================================
// HOOK: useAudioRecorder
// Responsabilidade única: encapsular MediaRecorder,
// timer, blob gravado, URL de prévia e cleanup.
//
// NÃO realiza: upload, envio de mensagem, integração
// com chatApi ou qualquer API de comunicação.
// =====================================================

import { useState, useRef, useEffect, useCallback } from 'react'

export interface UseAudioRecorderReturn {
  // Estados de gravação
  isRecording: boolean
  recordingSeconds: number

  // Estados de prévia
  audioBlobPreview: Blob | null
  audioPreviewUrl: string | null
  audioMimeType: string | null
  previewDurationSeconds: number

  // Ações
  startRecording: () => Promise<void>
  stopRecording: () => void
  cancelRecording: () => void
  clearPreview: () => void
}

function detectMimeType(): string {
  const candidates = ['audio/webm', 'audio/ogg', 'audio/mpeg']
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime
    }
  }
  // Fallback seguro: deixa o browser escolher
  return ''
}

export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [audioBlobPreview, setAudioBlobPreview] = useState<Blob | null>(null)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null)
  const [audioMimeType, setAudioMimeType] = useState<string | null>(null)
  const [previewDurationSeconds, setPreviewDurationSeconds] = useState(0)

  // Refs internas — não causam re-render
  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)
  // Ref espelhando recordingSeconds para leitura segura dentro de callbacks
  const recordingSecondsRef = useRef(0)
  // Ref espelhando audioPreviewUrl para revokeObjectURL no cleanup
  const audioPreviewUrlRef = useRef<string | null>(null)

  // --------------------------------------------------
  // Helpers internos
  // --------------------------------------------------

  const clearTimer = () => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  const stopStream = () => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
  }

  const revokePreviewUrl = (url: string | null) => {
    if (url) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        // silencioso — URL já pode ter sido revogada
      }
    }
  }

  // --------------------------------------------------
  // startRecording
  // --------------------------------------------------

  const startRecording = useCallback(async () => {
    // Ajuste 5: bloquear nova gravação enquanto existir prévia pendente.
    // Impede que o usuário inicie acidentalmente uma nova gravação antes
    // de decidir sobre a prévia atual (enviar ou cancelar).
    if (audioBlobPreview) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = detectMimeType()
      const recorderOptions = mimeType ? { mimeType } : {}
      const recorder = new MediaRecorder(stream, recorderOptions)
      // Captura o mimeType efetivo que o browser atribuiu
      const effectiveMime = recorder.mimeType || mimeType || 'audio/webm'

      recordedChunksRef.current = []
      setAudioMimeType(effectiveMime)

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        clearTimer()
        stopStream()

        if (recordedChunksRef.current.length === 0) {
          setIsRecording(false)
          return
        }

        // Captura duração antes de resetar o timer
        const duration = recordingSecondsRef.current

        const blob = new Blob(recordedChunksRef.current, { type: effectiveMime })
        const url = URL.createObjectURL(blob)

        // Atualiza ref para cleanup seguro
        audioPreviewUrlRef.current = url

        setAudioBlobPreview(blob)
        setAudioPreviewUrl(url)
        setPreviewDurationSeconds(duration)
        setRecordingSeconds(0)
        recordingSecondsRef.current = 0
        setIsRecording(false)
      }

      mediaRecorderRef.current = recorder
      recorder.start()

      // Inicia timer
      setRecordingSeconds(0)
      recordingSecondsRef.current = 0
      clearTimer()
      recordingTimerRef.current = window.setInterval(() => {
        recordingSecondsRef.current += 1
        setRecordingSeconds(recordingSecondsRef.current)
      }, 1000)

      setIsRecording(true)
    } catch (error) {
      console.error('[useAudioRecorder] Erro ao acessar microfone:', error)
      stopStream()
      clearTimer()
      setIsRecording(false)
    }
  }, [audioBlobPreview])

  // --------------------------------------------------
  // stopRecording — para e gera prévia (não envia)
  // --------------------------------------------------

  const stopRecording = useCallback(() => {
    try {
      mediaRecorderRef.current?.stop()
    } catch (error) {
      console.error('[useAudioRecorder] Erro ao parar gravação:', error)
      clearTimer()
      stopStream()
      setIsRecording(false)
    }
  }, [])

  // --------------------------------------------------
  // cancelRecording — descarta sem prévia
  // --------------------------------------------------

  const cancelRecording = useCallback(() => {
    // Intercepta o onstop para que não gere prévia
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null
    }
    try {
      mediaRecorderRef.current?.stop()
    } catch {
      // ignora
    }
    clearTimer()
    stopStream()
    recordedChunksRef.current = []
    setIsRecording(false)
    setRecordingSeconds(0)
    recordingSecondsRef.current = 0
  }, [])

  // --------------------------------------------------
  // clearPreview — chamado após envio com sucesso
  // --------------------------------------------------

  const clearPreview = useCallback(() => {
    revokePreviewUrl(audioPreviewUrlRef.current)
    audioPreviewUrlRef.current = null
    setAudioBlobPreview(null)
    setAudioPreviewUrl(null)
    setPreviewDurationSeconds(0)
    setAudioMimeType(null)
  }, [])

  // --------------------------------------------------
  // Cleanup ao desmontar o componente
  // --------------------------------------------------

  useEffect(() => {
    return () => {
      clearTimer()
      stopStream()
      revokePreviewUrl(audioPreviewUrlRef.current)
    }
  }, [])

  return {
    isRecording,
    recordingSeconds,
    audioBlobPreview,
    audioPreviewUrl,
    audioMimeType,
    previewDurationSeconds,
    startRecording,
    stopRecording,
    cancelRecording,
    clearPreview,
  }
}
