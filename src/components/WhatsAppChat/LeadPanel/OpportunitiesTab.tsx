// =====================================================
// COMPONENTE: OpportunitiesTab
// Data: 04/03/2026
// Objetivo: Aba de oportunidades no LeadPanel
// =====================================================

import { useState } from 'react'
import { Briefcase, Plus, DollarSign, Calendar, TrendingUp, Edit2 } from 'lucide-react'
import { useOpportunities } from '../../../hooks/useOpportunities'
import { CreateOpportunityModal } from '../../SalesFunnel/CreateOpportunityModal'
import { formatCurrency } from '../../../types/sales-funnel'

interface OpportunitiesTabProps {
  leadId: number
  leadName: string
  companyId: string
}

export const OpportunitiesTab: React.FC<OpportunitiesTabProps> = ({
  leadId,
  leadName,
  companyId
}) => {
  const { opportunities, loading, refreshOpportunities } = useOpportunities(leadId)
  const [showCreateModal, setShowCreateModal] = useState(false)

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-700'
      case 'won': return 'bg-green-100 text-green-700'
      case 'lost': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'open': return 'Aberta'
      case 'won': return 'Ganha'
      case 'lost': return 'Perdida'
      default: return status
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-500">Carregando oportunidades...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-purple-600" />
          <h3 className="font-semibold text-gray-900">Oportunidades</h3>
          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
            {opportunities.length}
          </span>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Nova
        </button>
      </div>

      {/* Lista de Oportunidades */}
      {opportunities.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Briefcase className="w-8 h-8 text-purple-600" />
          </div>
          <h4 className="font-medium text-gray-900 mb-2">Nenhuma oportunidade</h4>
          <p className="text-sm text-gray-500 mb-4">
            Crie a primeira oportunidade para este lead
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Criar Oportunidade
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {opportunities.map((opportunity) => (
            <div
              key={opportunity.id}
              className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              {/* Header do Card */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Briefcase className="w-4 h-4 text-purple-600" />
                    <h4 className="font-semibold text-gray-900 text-sm">
                      {opportunity.title}
                    </h4>
                  </div>
                  {opportunity.description && (
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {opportunity.description}
                    </p>
                  )}
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(opportunity.status)}`}>
                  {getStatusLabel(opportunity.status)}
                </span>
              </div>

              {/* Informações */}
              <div className="grid grid-cols-2 gap-3">
                {/* Valor */}
                {opportunity.value > 0 && (
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-600" />
                    <div>
                      <p className="text-xs text-gray-500">Valor</p>
                      <p className="text-sm font-semibold text-green-600">
                        {formatCurrency(opportunity.value)}
                      </p>
                    </div>
                  </div>
                )}

                {/* Probabilidade */}
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  <div>
                    <p className="text-xs text-gray-500">Probabilidade</p>
                    <p className="text-sm font-semibold text-blue-600">
                      {opportunity.probability}%
                    </p>
                  </div>
                </div>

                {/* Data Prevista */}
                {opportunity.expected_close_date && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-orange-600" />
                    <div>
                      <p className="text-xs text-gray-500">Previsão</p>
                      <p className="text-sm font-medium text-gray-900">
                        {new Date(opportunity.expected_close_date).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>
                )}

                {/* Origem */}
                {opportunity.source && (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4" />
                    <div>
                      <p className="text-xs text-gray-500">Origem</p>
                      <p className="text-sm font-medium text-gray-900">
                        {opportunity.source}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  Criada em {new Date(opportunity.created_at).toLocaleDateString('pt-BR')}
                </p>
                <button className="text-purple-600 hover:text-purple-700 transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Criação */}
      <CreateOpportunityModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        leadId={leadId}
        leadName={leadName}
        onSuccess={() => {
          refreshOpportunities()
          setShowCreateModal(false)
        }}
      />
    </div>
  )
}
