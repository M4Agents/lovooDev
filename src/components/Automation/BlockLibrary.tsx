// =====================================================
// COMPONENT: BLOCK LIBRARY
// Data: 13/03/2026
// Objetivo: Biblioteca de blocos para arrastar para o canvas
// =====================================================

import { useState } from 'react'
import { Zap, Target, GitBranch, MessageSquare, Clock, Flag, ChevronDown, ChevronRight } from 'lucide-react'

interface Block {
  type: string
  label: string
  icon: React.ReactNode
  color: string
  description: string
}

const BLOCK_CATEGORIES = {
  triggers: {
    title: 'Gatilhos',
    icon: '⚡',
    blocks: [
      {
        type: 'trigger',
        label: 'Novo Lead',
        icon: <Zap className="w-5 h-5" />,
        color: 'bg-green-500',
        description: 'Dispara quando um novo lead é criado'
      }
    ]
  },
  actions: {
    title: 'Ações',
    icon: '🎯',
    blocks: [
      {
        type: 'action',
        label: 'Criar Oportunidade',
        icon: <Target className="w-5 h-5" />,
        color: 'bg-blue-500',
        description: 'Cria uma nova oportunidade no funil'
      },
      {
        type: 'action',
        label: 'Atualizar Lead',
        icon: <Target className="w-5 h-5" />,
        color: 'bg-blue-500',
        description: 'Atualiza informações do lead'
      },
      {
        type: 'action',
        label: 'Adicionar Tag',
        icon: <Target className="w-5 h-5" />,
        color: 'bg-blue-500',
        description: 'Adiciona uma tag ao lead'
      }
    ]
  },
  conditions: {
    title: 'Condições',
    icon: '❓',
    blocks: [
      {
        type: 'condition',
        label: 'Verificar Campo',
        icon: <GitBranch className="w-5 h-5" />,
        color: 'bg-yellow-500',
        description: 'Verifica se um campo atende a condição'
      },
      {
        type: 'condition',
        label: 'Verificar Tag',
        icon: <GitBranch className="w-5 h-5" />,
        color: 'bg-yellow-500',
        description: 'Verifica se o lead possui uma tag'
      }
    ]
  },
  messages: {
    title: 'Mensagens',
    icon: '💬',
    blocks: [
      {
        type: 'message',
        label: 'Enviar Mensagem',
        icon: <MessageSquare className="w-5 h-5" />,
        color: 'bg-purple-500',
        description: 'Envia uma mensagem via WhatsApp'
      },
      {
        type: 'message',
        label: 'Mensagem com Botões',
        icon: <MessageSquare className="w-5 h-5" />,
        color: 'bg-purple-500',
        description: 'Envia mensagem com botões interativos'
      }
    ]
  },
  delays: {
    title: 'Aguardar',
    icon: '⏱️',
    blocks: [
      {
        type: 'delay',
        label: 'Aguardar Tempo',
        icon: <Clock className="w-5 h-5" />,
        color: 'bg-orange-500',
        description: 'Aguarda um período de tempo'
      }
    ]
  },
  end: {
    title: 'Finalização',
    icon: '🏁',
    blocks: [
      {
        type: 'end',
        label: 'Fim do Fluxo',
        icon: <Flag className="w-5 h-5" />,
        color: 'bg-red-500',
        description: 'Finaliza a execução do fluxo'
      }
    ]
  }
}

export default function BlockLibrary() {
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    triggers: true,
    actions: true,
    conditions: false,
    messages: false,
    delays: false,
    end: false
  })

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }))
  }

  const onDragStart = (event: React.DragEvent, block: Block) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify({
      type: block.type,
      label: block.label
    }))
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
      <div className="p-4 border-b border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900">Biblioteca de Blocos</h2>
        <p className="text-sm text-gray-500 mt-1">Arraste os blocos para o canvas</p>
      </div>

      <div className="p-4 space-y-2">
        {Object.entries(BLOCK_CATEGORIES).map(([key, category]) => (
          <div key={key} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleCategory(key)}
              className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex items-center justify-between transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{category.icon}</span>
                <span className="font-medium text-gray-900">{category.title}</span>
                <span className="text-xs text-gray-500">({category.blocks.length})</span>
              </div>
              {expandedCategories[key] ? (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronRight className="w-5 h-5 text-gray-400" />
              )}
            </button>

            {expandedCategories[key] && (
              <div className="p-2 space-y-2">
                {category.blocks.map((block, index) => (
                  <div
                    key={index}
                    draggable
                    onDragStart={(e) => onDragStart(e, block)}
                    className="p-3 border border-gray-200 rounded-lg cursor-move hover:border-blue-400 hover:shadow-md transition-all bg-white"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`${block.color} p-2 rounded-lg text-white flex-shrink-0`}>
                        {block.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-gray-900 truncate">
                          {block.label}
                        </h4>
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                          {block.description}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="text-xs text-gray-600">
          <p className="font-medium mb-2">💡 Dica:</p>
          <p>Arraste um bloco para o canvas e solte para adicioná-lo ao fluxo.</p>
        </div>
      </div>
    </div>
  )
}
