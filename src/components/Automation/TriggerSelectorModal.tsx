// =====================================================
// COMPONENT: TRIGGER SELECTOR MODAL
// Data: 15/03/2026
// Objetivo: Modal para selecionar tipo de gatilho (com categorias)
// =====================================================

import { useState } from 'react'
import { X, UserPlus, MessageCircle, TrendingUp, Tag, Clock, RefreshCw, UserCheck, UserMinus, RotateCcw, ChevronRight } from 'lucide-react'
import type { TriggerConfig } from '../../types/automation'

interface TriggerSelectorModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (trigger: TriggerConfig) => void
}

interface TriggerOption {
  type: string
  label: string
  description: string
  icon: any
  color: string
  /** Quando true: visível mas desabilitado — backend ainda não implementado */
  comingSoon?: boolean
}

interface TriggerCategory {
  id: string
  title: string
  icon: string
  triggers: TriggerOption[]
}

const TRIGGER_CATEGORIES: TriggerCategory[] = [
  {
    id: 'messages',
    title: 'Mensagens',
    icon: '💬',
    triggers: [
      {
        type: 'message.received',
        label: 'Mensagem Recebida',
        description: 'Dispara quando uma mensagem do WhatsApp é recebida',
        icon: MessageCircle,
        color: 'green'
      }
    ]
  },
  {
    id: 'opportunities',
    title: 'Oportunidades',
    icon: '💼',
    triggers: [
      {
        type: 'opportunity.created',
        label: 'Oportunidade Criada',
        description: 'Dispara quando uma nova oportunidade é criada em uma etapa',
        icon: TrendingUp,
        color: 'purple'
      },
      {
        type: 'opportunity.stage_changed',
        label: 'Oportunidade Movida',
        description: 'Dispara quando uma oportunidade é movida para outra etapa',
        icon: RefreshCw,
        color: 'orange'
      },
      {
        type: 'opportunity.won',
        label: 'Oportunidade Ganha',
        description: 'Dispara quando uma oportunidade é marcada como ganha',
        icon: TrendingUp,
        color: 'purple'
      },
      {
        type: 'opportunity.lost',
        label: 'Oportunidade Perdida',
        description: 'Dispara quando uma oportunidade é marcada como perdida',
        icon: TrendingUp,
        color: 'purple'
      },
      {
        type: 'opportunity.owner_assigned',
        label: 'Vendedor Atribuído',
        description: 'Dispara quando um vendedor é atribuído a uma oportunidade',
        icon: UserCheck,
        color: 'blue'
      },
      {
        type: 'opportunity.owner_removed',
        label: 'Vendedor Removido',
        description: 'Dispara quando um vendedor é retirado de uma oportunidade',
        icon: UserMinus,
        color: 'red'
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
        label: 'Lead Criado',
        description: 'Dispara quando um novo lead é criado no sistema',
        icon: UserPlus,
        color: 'blue'
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
        label: 'Tag Adicionada',
        description: 'Dispara quando uma tag é adicionada a um lead',
        icon: Tag,
        color: 'yellow'
      },
      {
        type: 'tag.removed',
        label: 'Tag Removida',
        description: 'Dispara quando uma tag é removida de um lead',
        icon: Tag,
        color: 'yellow'
      }
    ]
  },
  {
    id: 'schedule',
    title: 'Agendamento',
    icon: '⏰',
    triggers: [
      {
        type: 'schedule.time',
        label: 'Horário Agendado',
        description: 'Dispara em um horário específico (diário, semanal)',
        icon: Clock,
        color: 'red',
        comingSoon: true
      }
    ]
  }
]

export default function TriggerSelectorModal({ isOpen, onClose, onSelect }: TriggerSelectorModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('messages')
  const [selectedType, setSelectedType] = useState<string | null>(null)

  if (!isOpen) return null

  const currentCategory = TRIGGER_CATEGORIES.find(cat => cat.id === selectedCategory)

  const handleSelect = () => {
    if (!selectedType) return

    // Buscar o gatilho em todas as categorias
    let triggerType: TriggerOption | undefined
    for (const category of TRIGGER_CATEGORIES) {
      triggerType = category.triggers.find(t => t.type === selectedType)
      if (triggerType) break
    }

    if (!triggerType || triggerType.comingSoon) return

    const newTrigger: TriggerConfig = {
      id: crypto.randomUUID(),
      type: triggerType.type,
      label: triggerType.label,
      description: triggerType.description,
      enabled: true,
      config: {}
    }

    onSelect(newTrigger)
    setSelectedType(null)
    setSelectedCategory('messages')
    onClose()
  }

  const handleClose = () => {
    setSelectedType(null)
    setSelectedCategory('messages')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        {/* Overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75"
          onClick={handleClose}
        />

        {/* Modal */}
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-3xl sm:w-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                {currentCategory?.title || 'Selecionar Gatilho'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Adicione gatilhos para ações nos seus {currentCategory?.title.toLowerCase() || 'gatilhos'}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex" style={{ maxHeight: '60vh' }}>
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
                {currentCategory?.triggers.map((trigger) => {
                  const Icon = trigger.icon
                  const isDisabled = trigger.comingSoon
                  return (
                    <label
                      key={trigger.type}
                      className={`relative flex items-start p-3 border rounded-lg transition-colors ${
                        isDisabled
                          ? 'opacity-60 cursor-not-allowed bg-gray-50 border-gray-200'
                          : selectedType === trigger.type
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500 cursor-pointer'
                            : 'border-gray-300 hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <input
                        type="radio"
                        name="trigger_type"
                        value={trigger.type}
                        checked={selectedType === trigger.type}
                        onChange={(e) => !isDisabled && setSelectedType(e.target.value)}
                        disabled={isDisabled}
                        className="sr-only"
                      />
                      <div className="flex items-start flex-1">
                        <div className={`flex-shrink-0 p-2 rounded-lg ${isDisabled ? 'bg-gray-100' : `bg-${trigger.color}-100`}`}>
                          <Icon className={`w-5 h-5 ${isDisabled ? 'text-gray-400' : `text-${trigger.color}-600`}`} />
                        </div>
                        <div className="ml-3 flex-1">
                          <div className="flex items-center gap-2">
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                            <p className={`text-sm font-medium ${isDisabled ? 'text-gray-400' : 'text-gray-900'}`}>
                              {trigger.label}
                            </p>
                            {isDisabled && (
                              <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 leading-none">
                                Em breve
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-1 ml-6">{trigger.description}</p>
                        </div>
                      </div>
                      {!isDisabled && selectedType === trigger.type && (
                        <div className="flex-shrink-0 ml-3">
                          <div className="h-5 w-5 rounded-full bg-blue-600 flex items-center justify-center">
                            <svg
                              className="h-3 w-3 text-white"
                              fill="currentColor"
                              viewBox="0 0 12 12"
                            >
                              <path d="M3.707 5.293a1 1 0 00-1.414 1.414l1.414-1.414zM5 8l-.707.707a1 1 0 001.414 0L5 8zm4.707-3.293a1 1 0 00-1.414-1.414l1.414 1.414zm-7.414 2l2 2 1.414-1.414-2-2-1.414 1.414zm3.414 2l4-4-1.414-1.414-4 4 1.414 1.414z" />
                            </svg>
                          </div>
                        </div>
                      )}
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-6 py-4 flex items-center justify-end gap-3 border-t border-gray-200">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSelect}
              disabled={!selectedType}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Adicionar Gatilho
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
