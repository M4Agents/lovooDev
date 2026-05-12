// =====================================================
// PlaybookModal — Visualização do Playbook de Vendas da Etapa
//
// Modal somente-leitura acessível a todos os usuários logados.
// Exibe:
//   - Vídeo do YouTube (embed seguro via videoId validado)
//   - Texto do playbook (roteiro de vendas)
//
// Regras de segurança:
//   - URL do vídeo nunca entra diretamente no iframe
//   - videoId validado por regex /^[a-zA-Z0-9_-]{11}$/
//   - Conteúdo vazio/inválido não quebra o modal
//   - Sem verificação de role — leitura é pública para membros do funil
// =====================================================

import React from 'react'
import { X, BookOpen, AlertCircle } from 'lucide-react'
import type { FunnelStage } from '../../types/sales-funnel'

// ─── Utilitário de extração de videoId ─────────────────────────────────────
// Exportado para reutilização em FunnelColumn (cálculo de hasPlaybook).

const VIDEO_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/

const YOUTUBE_PATTERNS = [
  /[?&]v=([a-zA-Z0-9_-]{11})/,         // youtube.com/watch?v=ID
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,    // youtu.be/ID
  /\/embed\/([a-zA-Z0-9_-]{11})/,      // youtube.com/embed/ID
  /\/shorts\/([a-zA-Z0-9_-]{11})/,     // youtube.com/shorts/ID
]

export function extractYouTubeVideoId(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!trimmed) return null

  for (const pattern of YOUTUBE_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match?.[1] && VIDEO_ID_REGEX.test(match[1])) {
      return match[1]
    }
  }
  return null
}

// ─── Componente ─────────────────────────────────────────────────────────────

interface PlaybookModalProps {
  isOpen:   boolean
  onClose:  () => void
  stage:    FunnelStage
}

export const PlaybookModal: React.FC<PlaybookModalProps> = ({ isOpen, onClose, stage }) => {
  if (!isOpen) return null

  const hasText  = !!stage.playbook_text?.trim()
  const videoId  = extractYouTubeVideoId(stage.video_link)
  const hasVideo = !!videoId
  const hasContent = hasText || hasVideo

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-500" />
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Playbook da Etapa
              </h2>
              <p className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">
                {stage.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-5">

          {/* Sem conteúdo */}
          {!hasContent && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="w-10 h-10 text-gray-300 mb-3" />
              <p className="text-sm text-gray-500">
                Nenhum conteúdo de playbook cadastrado para esta etapa.
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Um administrador pode adicionar o playbook ao editar a etapa.
              </p>
            </div>
          )}

          {/* Vídeo do YouTube */}
          {hasVideo && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Vídeo de Treinamento
              </p>
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  className="absolute inset-0 w-full h-full rounded-lg border border-gray-200"
                  src={`https://www.youtube.com/embed/${videoId}`}
                  title={`Playbook — ${stage.name}`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}

          {/* Texto do Playbook */}
          {hasText && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Roteiro de Vendas
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                  {stage.playbook_text!.trim()}
                </pre>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  )
}
