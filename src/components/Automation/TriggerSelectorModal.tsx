// =====================================================
// COMPONENT: TRIGGER SELECTOR MODAL
// Data: 15/03/2026
// Objetivo: Modal para selecionar tipo de gatilho (com categorias)
// =====================================================

import { useState } from 'react'
import { X, UserPlus, MessageCircle, TrendingUp, Tag, Clock, RefreshCw, UserCheck, UserMinus, RotateCcw, ChevronRight, ShoppingCart, Package, Truck, XCircle, DollarSign } from 'lucide-react'
import type { TriggerConfig } from '../../types/automation'
import { useCompanyIntegration } from '../../hooks/useCompanyIntegration'

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
  /** Config padrão aplicado ao criar o trigger (ex: { channel: 'instagram' }) */
  defaultConfig?: Record<string, any>
}

interface TriggerCategory {
  id: string
  title: string
  icon: string
  triggers: TriggerOption[]
}

const BASE_TRIGGER_CATEGORIES: TriggerCategory[] = [
  {
    id: 'messages',
    title: 'Mensagens',
    icon: '💬',
    triggers: [
    {
        type: 'message.received',
        label: 'Mensagem Recebida — WhatsApp',
        description: 'Dispara quando uma mensagem do WhatsApp é recebida',
        icon: MessageCircle,
        color: 'green'
      },
      {
        type: 'message.received',
        label: 'Mensagem Recebida — Instagram Direct',
        description: 'Dispara quando uma DM do Instagram é recebida. As automações podem levar até aproximadamente um minuto para iniciar.',
        icon: MessageCircle,
        color: 'pink',
        defaultConfig: { channel: 'instagram' }
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

const NUVEMSHOP_CATEGORY: TriggerCategory = {
  id: 'nuvemshop',
  title: 'Nuvemshop',
  icon: '🛒',
  triggers: [
    {
      type: 'nuvemshop.checkout_abandoned',
      label: 'Carrinho Abandonado',
      description: 'Dispara quando um cliente abandona o carrinho na loja Nuvemshop',
      icon: ShoppingCart,
      color: 'orange',
    },
    {
      type: 'nuvemshop.order_created',
      label: 'Pedido Criado',
      description: 'Dispara quando um novo pedido é criado na loja',
      icon: Package,
      color: 'blue',
    },
    {
      type: 'nuvemshop.order_paid',
      label: 'Pedido Pago',
      description: 'Dispara quando o pagamento do pedido é confirmado',
      icon: DollarSign,
      color: 'green',
    },
    {
      type: 'nuvemshop.order_cancelled',
      label: 'Pedido Cancelado',
      description: 'Dispara quando um pedido é cancelado na loja',
      icon: XCircle,
      color: 'red',
    },
    {
      type: 'nuvemshop.order_fulfilled',
      label: 'Pedido Enviado (com rastreio)',
      description: 'Dispara quando o pedido é enviado com código de rastreio',
      icon: Truck,
      color: 'purple',
    },
    {
      type: 'nuvemshop.order_packed',
      label: 'Pedido Embalado',
      description: 'Dispara quando o pedido é embalado e está pronto para envio',
      icon: Package,
      color: 'indigo',
    },
  ]
}

export default function TriggerSelectorModal({ isOpen, onClose, onSelect }: TriggerSelectorModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('messages')
  // selectedKey = tipo composto: "type:defaultConfig.channel" (ex: "message.received:instagram")
  // Necessário porque dois triggers podem ter o mesmo type com channel diferente.
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const { hasNuvemshopEver, isDisconnected } = useCompanyIntegration()

  if (!isOpen) return null

  // Montar lista de categorias dinamicamente: inclui Nuvemshop apenas se a empresa já conectou
  const TRIGGER_CATEGORIES: TriggerCategory[] = hasNuvemshopEver
    ? [...BASE_TRIGGER_CATEGORIES, NUVEMSHOP_CATEGORY]
    : BASE_TRIGGER_CATEGORIES

  const currentCategory = TRIGGER_CATEGORIES.find(cat => cat.id === selectedCategory)

  // Gera chave única para cada trigger option
  const getTriggerKey = (trigger: TriggerOption) =>
    trigger.defaultConfig?.channel
      ? `${trigger.type}:${trigger.defaultConfig.channel}`
      : trigger.type

  const handleSelect = () => {
    if (!selectedKey) return

    // Buscar o gatilho em todas as categorias pela chave composta
    let triggerType: TriggerOption | undefined
    for (const category of TRIGGER_CATEGORIES) {
      triggerType = category.triggers.find(t => getTriggerKey(t) === selectedKey)
      if (triggerType) break
    }

    if (!triggerType || triggerType.comingSoon) return

    const newTrigger: TriggerConfig = {
      id: crypto.randomUUID(),
      type: triggerType.type,
      label: triggerType.label,
      description: triggerType.description,
      enabled: true,
      config: { ...(triggerType.defaultConfig ?? {}) }
    }

    onSelect(newTrigger)
    setSelectedKey(null)
    setSelectedCategory('messages')
    onClose()
  }

  const handleClose = () => {
    setSelectedKey(null)
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
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{category.title}</span>
                    {category.id === 'nuvemshop' && isDisconnected && (
                      <span className="block text-[10px] text-amber-600 leading-tight">desconectada</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Triggers List */}
            <div className="flex-1 overflow-y-auto p-6">
              {selectedCategory === 'nuvemshop' && isDisconnected && (
                <div className="mb-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <span className="mt-0.5">⚠️</span>
                  <span>A integração Nuvemshop está desconectada. Automações criadas aqui não receberão novos eventos até a reconexão. Gatilhos configurados continuam disponíveis para replay manual.</span>
                </div>
              )}
              <div className="space-y-3">
                {currentCategory?.triggers.map((trigger) => {
                  const Icon = trigger.icon
                  const isDisabled = trigger.comingSoon
                  const triggerKey = getTriggerKey(trigger)
                  return (
                    <label
                      key={triggerKey}
                      className={`relative flex items-start p-3 border rounded-lg transition-colors ${
                        isDisabled
                          ? 'opacity-60 cursor-not-allowed bg-gray-50 border-gray-200'
                          : selectedKey === triggerKey
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500 cursor-pointer'
                            : 'border-gray-300 hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <input
                        type="radio"
                        name="trigger_type"
                        value={triggerKey}
                        checked={selectedKey === triggerKey}
                        onChange={(e) => !isDisabled && setSelectedKey(e.target.value)}
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
                      {!isDisabled && selectedKey === triggerKey && (
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
              disabled={!selectedKey}
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
