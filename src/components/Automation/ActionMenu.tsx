// =====================================================
// COMPONENT: ACTION MENU
// Data: 14/03/2026
// Objetivo: Menu lateral de ações estilo Datacraz
// =====================================================

import React from 'react'
import { MessageCircle, Zap, GitBranch, Clock, Shuffle, Code, Wrench, Bot, FileCode, Flag } from 'lucide-react'
import { useMemo } from 'react'

interface ActionMenuProps {
  isOpen: boolean
  onClose: () => void
  onSelectAction: (actionType: string) => void
  position?: { x: number; y: number }
  lineStart?: { x: number; y: number } | null
}

interface ActionMenuItem {
  type: string
  label: string
  icon: React.ElementType
  description: string
  comingSoon?: boolean
}

const ACTIONS: ActionMenuItem[] = [
  {
    type: 'message',
    label: 'Mensagem',
    icon: MessageCircle,
    description: 'Enviar mensagem ao lead'
  },
  {
    type: 'action',
    label: 'Ações',
    icon: Zap,
    description: 'Executar ações no sistema'
  },
  {
    type: 'condition',
    label: 'Condições',
    icon: GitBranch,
    description: 'Adicionar condição lógica'
  },
  {
    type: 'delay',
    label: 'Espera',
    icon: Clock,
    description: 'Aguardar tempo específico'
  },
  {
    type: 'distribution',
    label: 'Distribuir Lead',
    icon: Shuffle,
    description: 'Distribui leads entre usuários automaticamente'
  },
  {
    type: 'api',
    label: 'API',
    icon: Code,
    description: 'Chamada de API externa',
    comingSoon: true
  },
  {
    type: 'field_operations',
    label: 'Operações de campos',
    icon: Wrench,
    description: 'Manipular campos do lead',
    comingSoon: true
  },
  {
    type: 'execute_agent',
    label: 'Executar Agente IA',
    icon: Bot,
    description: 'Executar um agente de IA e salvar a resposta'
  },
  {
    type: 'javascript',
    label: 'JavaScript',
    icon: FileCode,
    description: 'Executar código JavaScript',
    comingSoon: true
  },
  {
    type: 'end',
    label: 'Fim',
    icon: Flag,
    description: 'Finalizar o fluxo de automação'
  }
]

export default function ActionMenu({ isOpen, onClose, onSelectAction, position, lineStart }: ActionMenuProps) {
  if (!isOpen) return null

  const handleSelect = (actionType: string) => {
    onSelectAction(actionType)
    onClose()
  }

  // CORREÇÃO: Ajustar posição do menu para garantir que fique 100% visível
  const adjustedPosition = useMemo(() => {
    if (!position) return undefined
    
    const MENU_HEIGHT = 384 // max-h-96 em pixels
    const MENU_WIDTH = 256 // w-64 em pixels
    const MARGIN = 10 // Margem mínima das bordas
    
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    
    let adjustedX = position.x
    let adjustedY = position.y
    
    // Ajustar posição vertical
    const spaceBelow = viewportHeight - position.y
    if (spaceBelow < MENU_HEIGHT + MARGIN) {
      // Não há espaço suficiente abaixo, posicionar acima
      adjustedY = Math.max(MARGIN, position.y - MENU_HEIGHT)
    }
    
    // Ajustar posição horizontal
    const spaceRight = viewportWidth - position.x
    if (spaceRight < MENU_WIDTH + MARGIN) {
      // Não há espaço suficiente à direita, posicionar à esquerda
      adjustedX = Math.max(MARGIN, position.x - MENU_WIDTH)
    }
    
    return { x: adjustedX, y: adjustedY }
  }, [position])

  return (
    <>
      {/* Linha de conexão visual (estilo Datacraz) */}
      {lineStart && position && (
        <svg 
          className="fixed inset-0 pointer-events-none z-40"
          style={{ width: '100vw', height: '100vh' }}
        >
          <line
            x1={lineStart.x}
            y1={lineStart.y}
            x2={position.x}
            y2={position.y}
            stroke="#94a3b8"
            strokeWidth="2"
            strokeDasharray="5,5"
          />
        </svg>
      )}

      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-40" 
        onClick={onClose}
      />
      
      {/* Menu */}
      <div 
        className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 w-64 max-h-96 overflow-y-auto"
        style={{
          left: adjustedPosition?.x ? `${adjustedPosition.x}px` : '50%',
          top: adjustedPosition?.y ? `${adjustedPosition.y}px` : '50%',
          transform: adjustedPosition ? 'none' : 'translate(-50%, -50%)'
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 z-10">
          <h3 className="text-sm font-semibold text-gray-900">Adicionar ação</h3>
          <p className="text-xs text-gray-500 mt-0.5">Escolha uma ação para continuar o fluxo</p>
        </div>

        {/* Lista de ações */}
        <div className="p-2">
          {ACTIONS.map((action) => {
            const Icon = action.icon
            const disabled = action.comingSoon
            return (
              <button
                key={action.type}
                onClick={() => !disabled && handleSelect(action.type)}
                disabled={disabled}
                className={`w-full flex items-start gap-3 p-3 rounded-lg transition-colors text-left group ${
                  disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                }`}
              >
                <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                  disabled ? 'bg-gray-100' : 'bg-blue-50 group-hover:bg-blue-100'
                }`}>
                  <Icon className={`w-4 h-4 ${disabled ? 'text-gray-400' : 'text-blue-600'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium transition-colors ${
                      disabled ? 'text-gray-400' : 'text-gray-900 group-hover:text-blue-600'
                    }`}>
                      {action.label}
                    </span>
                    {disabled && (
                      <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 leading-none">
                        Em breve
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 leading-tight">
                    {action.description}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
