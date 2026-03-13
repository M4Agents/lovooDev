// =====================================================
// COMPONENT: ADD NODE BUTTON
// Data: 13/03/2026
// Objetivo: Botão flutuante para adicionar próxima ação
// FASE 7.5.3 - Botão + para Próxima Ação
// =====================================================

import { Plus } from 'lucide-react'
import { useState } from 'react'

interface AddNodeButtonProps {
  onAddNode: (nodeType: string) => void
  position: { x: number; y: number }
}

const nodeOptions = [
  { type: 'message', label: '💬 Mensagem', color: 'purple' },
  { type: 'condition', label: '🔀 Condição', color: 'yellow' },
  { type: 'action', label: '🎯 Ação CRM', color: 'blue' },
  { type: 'delay', label: '⏱️ Aguardar', color: 'orange' },
  { type: 'end', label: '🏁 Fim', color: 'red' }
]

export default function AddNodeButton({ onAddNode, position }: AddNodeButtonProps) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div
      className="absolute z-50"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -50%)'
      }}
    >
      {!showMenu ? (
        <button
          onClick={() => setShowMenu(true)}
          className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-all hover:scale-110"
          title="Adicionar próxima ação"
        >
          <Plus className="w-5 h-5" />
        </button>
      ) : (
        <div className="bg-white rounded-lg shadow-xl border-2 border-gray-200 p-2 min-w-[200px]">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-2 py-1 mb-1">
            Adicionar Bloco
          </div>
          <div className="space-y-1">
            {nodeOptions.map((option) => (
              <button
                key={option.type}
                onClick={() => {
                  onAddNode(option.type)
                  setShowMenu(false)
                }}
                className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 text-sm font-medium text-gray-700 transition-colors"
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-200 mt-2 pt-2">
            <button
              onClick={() => setShowMenu(false)}
              className="w-full text-center px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
