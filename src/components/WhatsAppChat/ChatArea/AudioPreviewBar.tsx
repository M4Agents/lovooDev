// =====================================================
// COMPONENT: AudioPreviewBar
// Exibe prévia do áudio gravado antes do envio.
// Estilo inspirado no WhatsApp: player nativo HTML5,
// duração, botão de cancelar e botão de enviar.
// =====================================================

import React from 'react'
import { Loader2, Send, Trash2 } from 'lucide-react'

export interface AudioPreviewBarProps {
  audioUrl: string
  durationSeconds: number
  isSending: boolean
  onCancel: () => void
  onSend: () => Promise<void> | void
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const AudioPreviewBar: React.FC<AudioPreviewBarProps> = ({
  audioUrl,
  durationSeconds,
  isSending,
  onCancel,
  onSend,
}) => {
  return (
    <div className="flex items-center gap-2 w-full px-1 py-1">
      {/* Botão cancelar */}
      <button
        type="button"
        onClick={onCancel}
        disabled={isSending}
        aria-label="Cancelar áudio"
        title="Cancelar áudio"
        className="flex-shrink-0 p-2 rounded-full border-2 border-red-300 text-red-500 hover:bg-red-50 hover:border-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {/* Player + duração */}
      <div className="flex-1 flex items-center gap-2 min-w-0 bg-gray-100 rounded-xl px-3 py-1.5">
        <audio
          src={audioUrl}
          controls
          className="flex-1 min-w-0 h-8"
          style={{ maxHeight: 32 }}
        />
        <span className="text-xs font-medium text-gray-500 tabular-nums flex-shrink-0 ml-1">
          {formatDuration(durationSeconds)}
        </span>
      </div>

      {/* Botão enviar */}
      <button
        type="button"
        onClick={onSend}
        disabled={isSending}
        aria-label={isSending ? 'Enviando áudio...' : 'Enviar áudio'}
        title={isSending ? 'Enviando...' : 'Enviar áudio'}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl font-medium text-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed min-h-[40px]"
      >
        {isSending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Send className="w-4 h-4" />
        )}
        <span className="hidden sm:inline">
          {isSending ? 'Enviando...' : 'Enviar'}
        </span>
      </button>
    </div>
  )
}
