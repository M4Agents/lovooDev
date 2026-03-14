// =====================================================
// COMPONENT: ADD TRIGGER MODAL
// Data: 14/03/2026
// Objetivo: Modal categorizado para adicionar gatilhos (estilo Datacraz)
// =====================================================

import { useState } from 'react'
import { X, ChevronRight, MessageCircle, UserPlus, Tag, TrendingUp, UserCheck, UserMinus, RotateCcw } from 'lucide-react'

interface TriggerOption {
  type: string
  label: string
  icon: React.ReactNode
  description: string
}

interface TriggerCategory {
  id: string
  title: string
  icon: string
  triggers: TriggerOption[]
}

const TRIGGER_CATEGORIES: TriggerCategory[] = [
  {
    id: 'opportunities',
    title: 'Oportunidades',
    icon: '💼',
    triggers: [
      {
        type: 'opportunity.created',
        label: 'Oportunidade criada',
        icon: <TrendingUp className="w-5 h-5" />,
        description: 'Quando uma oportunidade é criada em uma etapa.'
      },
      {
        type: 'opportunity.stage_changed',
        label: 'Oportunidade movida',
        icon: <TrendingUp className="w-5 h-5" />,
        description: 'Quando uma oportunidade é movida para a etapa'
      },
      {
        type: 'opportunity.won',
        label: 'Oportunidade ganha',
        icon: <TrendingUp className="w-5 h-5" />,
        description: 'Quando uma oportunidade é marcada como ganha'
      },
      {
        type: 'opportunity.lost',
        label: 'Oportunidade perdida',
        icon: <TrendingUp className="w-5 h-5" />,
        description: 'Quando uma oportunidade é marcada como perdida'
      },
      {
        type: 'opportunity.owner_assigned',
        label: 'Vendedor atribuído',
        icon: <UserCheck className="w-5 h-5" />,
        description: 'Quando um vendedor é atribuído a uma oportunidade'
      },
      {
        type: 'opportunity.owner_removed',
        label: 'Vendedor removido',
        icon: <UserMinus className="w-5 h-5" />,
        description: 'Quando um vendedor é retirado de uma oportunidade'
      },
      {
        type: 'opportunity.restored',
        label: 'Oportunidade restaurada',
        icon: <RotateCcw className="w-5 h-5" />,
        description: 'Quando uma oportunidade ganha/perdida é reaberta'
      }
    ]
  },
  {
    id: 'leads',
    title: 'Leads',
    icon: '👤',
    triggers: [
      {
        type: 'lead.created',
        label: 'Lead criado',
        icon: <UserPlus className="w-5 h-5" />,
        description: 'Quando um novo lead é criado'
      }
    ]
  },
  {
    id: 'messages',
    title: 'Mensagens',
    icon: '💬',
    triggers: [
      {
        type: 'message.received',
        label: 'Mensagem recebida',
        icon: <MessageCircle className="w-5 h-5" />,
        description: 'Quando receber uma mensagem'
      },
      {
        type: 'message.sent',
        label: 'Mensagem enviada',
        icon: <MessageCircle className="w-5 h-5" />,
        description: 'Quando enviar uma mensagem'
      }
    ]
  },
  {
    id: 'tags',
    title: 'Tags',
    icon: '🏷️',
    triggers: [
      {
        type: 'tag.added',
        label: 'Tag adicionada',
        icon: <Tag className="w-5 h-5" />,
        description: 'Quando uma tag é adicionada'
      },
      {
        type: 'tag.removed',
        label: 'Tag removida',
        icon: <Tag className="w-5 h-5" />,
        description: 'Quando uma tag é removida'
      }
    ]
  }
]

interface AddTriggerModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectTrigger: (triggerType: string, triggerLabel: string) => void
}

export default function AddTriggerModal({ isOpen, onClose, onSelectTrigger }: AddTriggerModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('opportunities')

  if (!isOpen) return null

  const currentCategory = TRIGGER_CATEGORIES.find(cat => cat.id === selectedCategory)

  const handleTriggerClick = (trigger: TriggerOption) => {
    onSelectTrigger(trigger.type, trigger.label)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {currentCategory?.title || 'Gatilhos'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Adicione gatilhos para ações nos seus {currentCategory?.title.toLowerCase() || 'gatilhos'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-48 border-r border-gray-200 bg-gray-50 overflow-y-auto">
            {TRIGGER_CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors ${
                  selectedCategory === category.id
                    ? 'bg-white border-r-2 border-blue-600 text-blue-600'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <span className="text-xl">{category.icon}</span>
                <span className="text-sm font-medium">{category.title}</span>
              </button>
            ))}
          </div>

          {/* Triggers List */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-3">
              {currentCategory?.triggers.map((trigger, index) => (
                <button
                  key={index}
                  onClick={() => handleTriggerClick(trigger)}
                  className="w-full p-4 border border-gray-200 rounded-lg hover:border-blue-400 hover:shadow-md transition-all text-left group"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600 group-hover:bg-blue-100 transition-colors">
                      {trigger.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-600 transition-colors" />
                        <h3 className="text-sm font-medium text-gray-900">
                          {trigger.label}
                        </h3>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 ml-6">
                        {trigger.description}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
