// =====================================================
// COMPONENT: CREATE FLOW MODAL
// Data: 13/03/2026
// Objetivo: Modal para criar novo fluxo de automação
// =====================================================

import { useState } from 'react'
import { X, Zap, AlertCircle } from 'lucide-react'
import type { CreateFlowForm } from '../../types/automation'

interface CreateFlowModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateFlowForm) => Promise<void>
}

const TRIGGER_TYPES = [
  {
    value: 'lead.created',
    label: 'Novo Lead Criado',
    description: 'Dispara quando um novo lead é criado no sistema',
    icon: '👤'
  },
  {
    value: 'message.received',
    label: 'Mensagem Recebida',
    description: 'Dispara quando uma mensagem do WhatsApp é recebida',
    icon: '💬'
  },
  {
    value: 'opportunity.created',
    label: 'Oportunidade Criada',
    description: 'Dispara quando uma nova oportunidade é criada',
    icon: '🎯'
  },
  {
    value: 'opportunity.stage_changed',
    label: 'Mudança de Etapa',
    description: 'Dispara quando uma oportunidade muda de etapa no funil',
    icon: '🔄'
  },
  {
    value: 'tag.added',
    label: 'Tag Adicionada',
    description: 'Dispara quando uma tag é adicionada a um lead',
    icon: '🏷️'
  },
  {
    value: 'schedule.time',
    label: 'Horário Agendado',
    description: 'Dispara em um horário específico (diário, semanal)',
    icon: '⏰'
  }
]

const CATEGORIES = [
  { value: 'vendas', label: 'Vendas' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'suporte', label: 'Suporte' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'reengajamento', label: 'Reengajamento' },
  { value: 'outros', label: 'Outros' }
]

export default function CreateFlowModal({ isOpen, onClose, onSubmit }: CreateFlowModalProps) {
  const [formData, setFormData] = useState<CreateFlowForm>({
    name: '',
    description: '',
    category: '',
    trigger_type: '',
    trigger_config: {}
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Nome do fluxo é obrigatório'
    } else if (formData.name.length > 255) {
      newErrors.name = 'Nome deve ter no máximo 255 caracteres'
    }

    if (!formData.trigger_type) {
      newErrors.trigger_type = 'Selecione um gatilho'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    try {
      setIsSubmitting(true)
      await onSubmit(formData)
      handleClose()
    } catch (error) {
      console.error('Erro ao criar fluxo:', error)
      setErrors({ submit: 'Erro ao criar fluxo. Tente novamente.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    setFormData({
      name: '',
      description: '',
      category: '',
      trigger_type: '',
      trigger_config: {}
    })
    setErrors({})
    setIsSubmitting(false)
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
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-white bg-opacity-20">
                  <Zap className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-white">
                  Criar Novo Fluxo de Automação
                </h3>
              </div>
              <button
                onClick={handleClose}
                className="text-white hover:text-gray-200 transition-colors"
              >
                <X className="h-6 w-6" />
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit}>
            <div className="bg-white px-6 py-6 space-y-6">
              {/* Error Message */}
              {errors.submit && (
                <div className="rounded-md bg-red-50 p-4">
                  <div className="flex">
                    <AlertCircle className="h-5 w-5 text-red-400" />
                    <div className="ml-3">
                      <p className="text-sm text-red-800">{errors.submit}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Nome do Fluxo */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                  Nome do Fluxo <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className={`mt-1 block w-full rounded-md shadow-sm sm:text-sm ${
                    errors.name
                      ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                      : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                  }`}
                  placeholder="Ex: Boas-vindas para novos leads"
                  maxLength={255}
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-red-600">{errors.name}</p>
                )}
              </div>

              {/* Descrição */}
              <div>
                <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                  Descrição
                </label>
                <textarea
                  id="description"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Descreva o objetivo deste fluxo..."
                />
              </div>

              {/* Categoria */}
              <div>
                <label htmlFor="category" className="block text-sm font-medium text-gray-700">
                  Categoria
                </label>
                <select
                  id="category"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                >
                  <option value="">Selecione uma categoria</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Gatilho */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Gatilho (Quando executar) <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-1 gap-3">
                  {TRIGGER_TYPES.map((trigger) => (
                    <label
                      key={trigger.value}
                      className={`relative flex items-start p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors ${
                        formData.trigger_type === trigger.value
                          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500'
                          : 'border-gray-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="trigger_type"
                        value={trigger.value}
                        checked={formData.trigger_type === trigger.value}
                        onChange={(e) =>
                          setFormData({ ...formData, trigger_type: e.target.value })
                        }
                        className="sr-only"
                      />
                      <div className="flex items-start flex-1">
                        <span className="text-2xl mr-3">{trigger.icon}</span>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{trigger.label}</p>
                          <p className="text-xs text-gray-500 mt-1">{trigger.description}</p>
                        </div>
                      </div>
                      {formData.trigger_type === trigger.value && (
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
                  ))}
                </div>
                {errors.trigger_type && (
                  <p className="mt-2 text-sm text-red-600">{errors.trigger_type}</p>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 px-6 py-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Criando...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Criar Fluxo
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
