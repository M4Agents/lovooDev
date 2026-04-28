/**
 * EnrichDiffModal
 *
 * Modal de comparação entre o prompt atual e o prompt sugerido pelo endpoint
 * POST /api/prompt-builder/enrich-tools.
 *
 * Regras de uso:
 *   - Não altera advancedText automaticamente.
 *   - O usuário deve clicar explicitamente em "Aplicar" para confirmar.
 *   - Renderizado via createPortal em document.body para escapar do stacking context do modal pai.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Check, Copy } from 'lucide-react'

interface Props {
  currentPrompt:   string
  suggestedPrompt: string
  onApply:         () => void
  onCopy:          () => void
  onCancel:        () => void
}

export function EnrichDiffModal({ currentPrompt, suggestedPrompt, onApply, onCopy, onCancel }: Props) {
  // Bloqueia scroll do body enquanto o modal estiver aberto
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col"
        style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Revisão do prompt adaptado</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Compare o prompt atual com a versão sugerida. Aplique apenas se estiver satisfeito.
            </p>
          </div>
          <button
            onClick={onCancel}
            aria-label="Fechar"
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400
                       hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Corpo: dois painéis lado a lado */}
        <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-200 overflow-hidden">

          {/* Painel esquerdo: prompt atual */}
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex-shrink-0">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Prompt atual
              </span>
            </div>
            <textarea
              readOnly
              value={currentPrompt}
              className="flex-1 min-h-0 w-full px-4 py-3 text-xs text-gray-700 font-mono
                         resize-none focus:outline-none bg-white leading-relaxed
                         overflow-y-auto [scrollbar-width:thin]"
              style={{ minHeight: '300px' }}
            />
          </div>

          {/* Painel direito: prompt sugerido */}
          <div className="flex flex-col min-h-0">
            <div className="px-4 py-2.5 bg-blue-50 border-b border-blue-100 flex-shrink-0">
              <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
                Prompt sugerido (com ações do agente)
              </span>
            </div>
            <textarea
              readOnly
              value={suggestedPrompt}
              className="flex-1 min-h-0 w-full px-4 py-3 text-xs text-gray-700 font-mono
                         resize-none focus:outline-none bg-blue-50/30 leading-relaxed
                         overflow-y-auto [scrollbar-width:thin]"
              style={{ minHeight: '300px' }}
            />
          </div>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-200 bg-gray-50 flex-shrink-0 gap-3 flex-wrap">
          <p className="text-xs text-gray-400">
            Ao aplicar, o prompt atual será substituído pelo sugerido. Esta ação pode ser desfeita manualmente.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm text-gray-600 rounded-lg border border-gray-200
                         hover:bg-gray-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={onCopy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-blue-700
                         rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              Copiar sugerido
            </button>
            <button
              onClick={onApply}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-sm text-white
                         bg-green-600 rounded-lg hover:bg-green-700 transition-colors font-medium"
            >
              <Check className="w-3.5 h-3.5" />
              Aplicar
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body,
  )
}
