// =====================================================
// COMPONENT: TRIGGER SELECTOR MODAL
// Data: 15/03/2026
// Objetivo: Modal para selecionar tipo de gatilho
// =====================================================

import { useState } from 'react'
import { X, UserPlus, MessageCircle, TrendingUp, Tag, Clock, RefreshCw } from 'lucide-react'
import type { TriggerConfig } from '../../types/automation'

interface TriggerSelectorModalProps {
  isOpen: boolean
  onClose: () => void
  onSelect: (trigger: TriggerConfig) => void
}

const TRIGGER_TYPES = [
  {
    type: 'lead.created',
    label: 'Novo Lead Criado',
    description: 'Dispara quando um novo lead é criado no sistema',
    icon: UserPlus,
    color: 'blue'
  },
  {
    type: 'message.received',
    label: 'Mensagem Recebida',
    description: 'Dispara quando uma mensagem do WhatsApp é recebida',
    icon: MessageCircle,
    color: 'green'
  },
  {
    type: 'opportunity.created',
    label: 'Oportunidade Criada',
    description: 'Dispara quando uma nova oportunidade é criada',
    icon: TrendingUp,
    color: 'purple'
  },
  {
    type: 'opportunity.stage_changed',
    label: 'Mudança de Etapa',
    description: 'Dispara quando uma oportunidade muda de etapa no funil',
    icon: RefreshCw,
    color: 'orange'
  },
  {
    type: 'tag.added',
    label: 'Tag Adicionada',
    description: 'Dispara quando uma tag é adicionada a um lead',
    icon: Tag,
    color: 'yellow'
  },
  {
    type: 'schedule.time',
    label: 'Horário Agendado',
    description: 'Dispara em um horário específico (diário, semanal)',
    icon: Clock,
    color: 'red'
  }
]

export default function TriggerSelectorModal({ isOpen, onClose, onSelect }: TriggerSelectorModalProps) {
  const [selectedType, setSelectedType] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSelect = () => {
    if (!selectedType) return

    const triggerType = TRIGGER_TYPES.find(t => t.type === selectedType)
    if (!triggerType) return

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
    onClose()
  }

  const handleClose = () => {
    setSelectedType(null)
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
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Selecionar Gatilho
              </h3>
              <button
                onClick={handleClose}
                className="text-white hover:text-gray-200 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="bg-white px-6 py-4">
            <p className="text-sm text-gray-600 mb-4">
              Escolha o evento que irá disparar este fluxo de automação:
            </p>

            <div className="space-y-2">
              {TRIGGER_TYPES.map((trigger) => {
                const Icon = trigger.icon
                return (
                  <label
                    key={trigger.type}
                    className={`relative flex items-start p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedType === trigger.type
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                        : 'border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="trigger_type"
                      value={trigger.type}
                      checked={selectedType === trigger.type}
                      onChange={(e) => setSelectedType(e.target.value)}
                      className="sr-only"
                    />
                    <div className="flex items-start flex-1">
                      <div className={`flex-shrink-0 p-2 rounded-lg bg-${trigger.color}-100`}>
                        <Icon className={`w-5 h-5 text-${trigger.color}-600`} />
                      </div>
                      <div className="ml-3 flex-1">
                        <p className="text-sm font-medium text-gray-900">{trigger.label}</p>
                        <p className="text-xs text-gray-500 mt-1">{trigger.description}</p>
                      </div>
                    </div>
                    {selectedType === trigger.type && (
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

          {/* Footer */}
          <div className="bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
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
