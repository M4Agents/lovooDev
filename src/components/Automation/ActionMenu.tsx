// =====================================================
// COMPONENT: ACTION MENU
// Data: 14/03/2026
// Objetivo: Menu lateral de ações estilo Datacraz
// =====================================================

import { MessageCircle, Zap, GitBranch, Clock, Shuffle, Code, Wrench, Brain, FileCode, Flag } from 'lucide-react'

interface ActionMenuProps {
  isOpen: boolean
  onClose: () => void
  onSelectAction: (actionType: string) => void
  position?: { x: number; y: number }
  lineStart?: { x: number; y: number } | null
}

const ACTIONS = [
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
    type: 'randomizer',
    label: 'Randomizador',
    icon: Shuffle,
    description: 'Escolha aleatória de caminho'
  },
  {
    type: 'api',
    label: 'API',
    icon: Code,
    description: 'Chamada de API externa'
  },
  {
    type: 'field_operations',
    label: 'Operações de campos',
    icon: Wrench,
    description: 'Manipular campos do lead'
  },
  {
    type: 'ai',
    label: 'IA',
    icon: Brain,
    description: 'Inteligência artificial'
  },
  {
    type: 'javascript',
    label: 'JavaScript',
    icon: FileCode,
    description: 'Executar código JavaScript'
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
          left: position?.x ? `${position.x}px` : '50%',
          top: position?.y ? `${position.y}px` : '50%',
          transform: position ? 'none' : 'translate(-50%, -50%)'
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
            return (
              <button
                key={action.type}
                onClick={() => handleSelect(action.type)}
                className="w-full flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors text-left group"
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                  <Icon className="w-4 h-4 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                    {action.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 leading-tight">
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
