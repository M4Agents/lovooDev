// =====================================================
// COMPONENTE: LeadCardCustomizer
// Data: 03/03/2026
// Objetivo: Modal para personalizar campos visíveis nos cards
// =====================================================

import { useState, useEffect } from 'react'
import { X, Loader2, Eye, EyeOff } from 'lucide-react'
import { FUNNEL_CONSTANTS } from '../../types/sales-funnel'

interface LeadCardCustomizerProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (visibleFields: string[]) => Promise<void>
  currentVisibleFields: string[]
}

const FIELD_LABELS: Record<string, string> = {
  photo: 'Foto do Lead',
  name: 'Nome',
  email: 'Email',
  phone: 'Telefone',
  company: 'Empresa',
  tags: 'Tags',
  deal_value: 'Valor do Negócio',
  probability: 'Probabilidade de Fechamento',
  origin: 'Origem',
  status: 'Status',
  created_at: 'Data de Criação',
  last_contact_at: 'Último Contato'
}

const FIELD_DESCRIPTIONS: Record<string, string> = {
  photo: 'Exibe a foto de perfil ou avatar do lead',
  name: 'Nome completo do lead',
  email: 'Endereço de email do lead',
  phone: 'Número de telefone do lead',
  company: 'Nome da empresa do lead',
  tags: 'Tags associadas ao lead',
  deal_value: 'Valor estimado do negócio',
  probability: 'Chance de fechamento em % (ex: 50%)',
  origin: 'Origem do lead (ex: WhatsApp, Site)',
  status: 'Status atual do lead',
  created_at: 'Data em que o lead foi criado',
  last_contact_at: 'Data do último contato com o lead'
}

export const LeadCardCustomizer: React.FC<LeadCardCustomizerProps> = ({
  isOpen,
  onClose,
  onSubmit,
  currentVisibleFields
}) => {
  const [visibleFields, setVisibleFields] = useState<string[]>(currentVisibleFields)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setVisibleFields(currentVisibleFields)
  }, [currentVisibleFields])

  const toggleField = (field: string) => {
    if (visibleFields.includes(field)) {
      setVisibleFields(visibleFields.filter(f => f !== field))
    } else {
      setVisibleFields([...visibleFields, field])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    try {
      setLoading(true)
      await onSubmit(visibleFields)
      onClose()
    } catch (err) {
      console.error('Error saving preferences:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setVisibleFields(currentVisibleFields)
      onClose()
    }
  }

  const handleSelectAll = () => {
    setVisibleFields([...FUNNEL_CONSTANTS.ALL_AVAILABLE_FIELDS])
  }

  const handleDeselectAll = () => {
    setVisibleFields([])
  }

  const handleResetToDefault = () => {
    setVisibleFields([...FUNNEL_CONSTANTS.DEFAULT_VISIBLE_FIELDS])
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Personalizar Cards dos Leads
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Escolha quais informações exibir nos cards do Kanban
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Actions */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Selecionar Todos
            </button>
            <button
              type="button"
              onClick={handleDeselectAll}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Desmarcar Todos
            </button>
            <button
              type="button"
              onClick={handleResetToDefault}
              disabled={loading}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Restaurar Padrão
            </button>
            <div className="flex-1" />
            <span className="text-sm text-gray-600">
              {visibleFields.length} de {FUNNEL_CONSTANTS.ALL_AVAILABLE_FIELDS.length} selecionados
            </span>
          </div>
        </div>

        {/* Fields List */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FUNNEL_CONSTANTS.ALL_AVAILABLE_FIELDS.map((field) => {
              const isVisible = visibleFields.includes(field)
              
              return (
                <label
                  key={field}
                  className={`
                    flex items-start gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all
                    ${isVisible 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }
                  `}
                >
                  <input
                    type="checkbox"
                    checked={isVisible}
                    onChange={() => toggleField(field)}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    disabled={loading}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {isVisible ? (
                        <Eye className="w-4 h-4 text-blue-600" />
                      ) : (
                        <EyeOff className="w-4 h-4 text-gray-400" />
                      )}
                      <p className="font-medium text-gray-900">
                        {FIELD_LABELS[field] || field}
                      </p>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {FIELD_DESCRIPTIONS[field] || 'Campo do lead'}
                    </p>
                  </div>
                </label>
              )
            })}
          </div>
        </div>

        {/* Info */}
        <div className="px-6 py-4 bg-blue-50 border-t border-blue-200">
          <p className="text-sm text-blue-800">
            💡 <strong>Dica:</strong> Selecione apenas os campos mais importantes para manter os cards limpos e organizados. Você pode alterar isso a qualquer momento.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Salvando...' : 'Salvar Preferências'}
          </button>
        </div>
      </div>
    </div>
  )
}
