// =====================================================
// COMPONENTE: AddLeadToFunnelModal
// Data: 03/03/2026
// Objetivo: Modal para adicionar lead ao funil
// =====================================================

import { useState } from 'react'
import { X, Loader2, AlertCircle, Search } from 'lucide-react'

interface Lead {
  id: number
  name: string
  email?: string
  phone?: string
  company_name?: string
}

interface AddLeadToFunnelModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (leadId: number, stageId: string) => Promise<void>
  funnelId: string
  stageId: string
  availableLeads: Lead[]
}

export const AddLeadToFunnelModal: React.FC<AddLeadToFunnelModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  stageId,
  availableLeads
}) => {
  const [selectedLeadId, setSelectedLeadId] = useState<number>()
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()

  const filteredLeads = availableLeads.filter(lead => {
    const search = searchTerm.toLowerCase()
    return (
      lead.name.toLowerCase().includes(search) ||
      lead.email?.toLowerCase().includes(search) ||
      lead.phone?.includes(search) ||
      lead.company_name?.toLowerCase().includes(search)
    )
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedLeadId) {
      setError('Selecione um lead')
      return
    }

    try {
      setLoading(true)
      setError(undefined)
      await onSubmit(selectedLeadId, stageId)
      
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao adicionar lead')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setSelectedLeadId(undefined)
      setSearchTerm('')
      setError(undefined)
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Adicionar Lead ao Funil
          </h2>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-6 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, email ou telefone..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading}
            />
          </div>
        </div>

        {/* Lead List */}
        <div className="flex-1 overflow-y-auto p-6">
          {filteredLeads.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">
                {searchTerm ? 'Nenhum lead encontrado' : 'Nenhum lead disponível'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredLeads.map((lead) => (
                <label
                  key={lead.id}
                  className={`
                    flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all
                    ${selectedLeadId === lead.id 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="lead"
                    value={lead.id}
                    checked={selectedLeadId === lead.id}
                    onChange={() => setSelectedLeadId(lead.id)}
                    className="mt-1 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                    disabled={loading}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {lead.name}
                    </p>
                    {lead.email && (
                      <p className="text-sm text-gray-600 truncate">
                        {lead.email}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {lead.phone && (
                        <span className="text-xs text-gray-500">
                          {lead.phone}
                        </span>
                      )}
                      {lead.company_name && (
                        <span className="text-xs text-gray-500">
                          {lead.company_name}
                        </span>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-6 pb-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        )}

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
            disabled={loading || !selectedLeadId}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Adicionando...' : 'Adicionar Lead'}
          </button>
        </div>
      </div>
    </div>
  )
}
