// =====================================================
// COMPONENT: AUDIO RECORDER
// Data: 17/03/2026
// Objetivo: Componente reutilizável para gravação de áudio
// =====================================================

import { useState, useRef, useEffect } from 'react'
import { Mic, Square, X } from 'lucide-react'

interface AudioRecorderProps {
  onRecordingComplete: (file: File) => void
  maxDuration?: number  // segundos (padrão: 300 = 5min)
  disabled?: boolean
}

export default function AudioRecorder({ 
  onRecordingComplete, 
  maxDuration = 300,
  disabled = false 
}: AudioRecorderProps) {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Limpar recursos ao desmontar
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
      }
    }
  }, [])

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      
      const recorder = new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      recordedChunksRef.current = []

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/ogg' })
        const file = new File([blob], `audio-${Date.now()}.ogg`, { 
          type: 'audio/ogg' 
        })
        
        onRecordingComplete(file)
        
        // Limpar recursos
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop())
          streamRef.current = null
        }
        
        setIsRecording(false)
        setRecordingSeconds(0)
      }

      recorder.start()
      setIsRecording(true)

      // Iniciar timer
      setRecordingSeconds(0)
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
      }
      recordingTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((prev) => {
          const newSeconds = prev + 1
          // Parar automaticamente ao atingir duração máxima
          if (newSeconds >= maxDuration) {
            stopRecording()
          }
          return newSeconds
        })
      }, 1000)

    } catch (error) {
      console.error('Erro ao acessar microfone:', error)
      alert('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
      setIsRecording(false)
    }
  }

  const stopRecording = () => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
      }
    } catch (error) {
      console.error('Erro ao parar gravação:', error)
    }
  }

  const cancelRecording = () => {
    try {
      recordedChunksRef.current = []
      
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
      }
      
      setIsRecording(false)
      setRecordingSeconds(0)
    } catch (error) {
      console.error('Erro ao cancelar gravação:', error)
    }
  }

  if (isRecording) {
    return (
      <div className="border-2 border-red-300 rounded-lg p-4 bg-red-50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <span className="text-sm font-medium text-gray-700">
              Gravando...
            </span>
          </div>
          <span className="text-lg font-mono font-bold text-red-600">
            {formatTime(recordingSeconds)}
          </span>
        </div>
        
        <div className="flex gap-2">
          <button
            type="button"
            onClick={cancelRecording}
            className="flex-1 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <X className="w-4 h-4" />
            <span className="text-sm font-medium">Cancelar</span>
          </button>
          
          <button
            type="button"
            onClick={stopRecording}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
          >
            <Square className="w-4 h-4" />
            <span className="text-sm font-medium">Parar e Salvar</span>
          </button>
        </div>
        
        {maxDuration - recordingSeconds <= 30 && (
          <p className="text-xs text-red-600 mt-2 text-center">
            {maxDuration - recordingSeconds}s restantes
          </p>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startRecording}
      disabled={disabled}
      className="w-full border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex flex-col items-center gap-2">
        <Mic className="w-8 h-8 text-gray-400" />
        <div className="text-sm font-medium text-gray-700">
          Gravar Áudio
        </div>
        <div className="text-xs text-gray-500">
          Clique para iniciar gravação (máx. {Math.floor(maxDuration / 60)}min)
        </div>
      </div>
    </button>
  )
}
