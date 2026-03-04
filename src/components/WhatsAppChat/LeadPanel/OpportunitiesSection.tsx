// =====================================================
// COMPONENTE: OpportunitiesSection (Compacto)
// Data: 04/03/2026
// Objetivo: Seção de oportunidades dentro da aba Informações
// =====================================================

import { useState } from 'react'
import { Briefcase, Plus, DollarSign, TrendingUp } from 'lucide-react'
import { useOpportunities } from '../../../hooks/useOpportunities'
import { CreateOpportunityModal } from '../../SalesFunnel/CreateOpportunityModal'
import { formatCurrency } from '../../../types/sales-funnel'

interface OpportunitiesSectionProps {
  leadId: number
  leadName: string
}

export const OpportunitiesSection: React.FC<OpportunitiesSectionProps> = ({
  leadId,
  leadName
}) => {
  console.log('💼 OpportunitiesSection - Rendered with leadId:', leadId, 'type:', typeof leadId)
  
  const { opportunities, loading, refreshOpportunities } = useOpportunities(leadId)
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Filtrar apenas oportunidades abertas
  const activeOpportunities = opportunities.filter(opp => opp.status === 'open')

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-700'
      case 'won': return 'bg-green-100 text-green-700'
      case 'lost': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (loading) {
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-purple-600" />
            <h3 className="text-sm font-semibold text-gray-900">Oportunidades</h3>
          </div>
        </div>
        <div className="text-center py-4">
          <div className="w-6 h-6 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Briefcase className="w-4 h-4 text-purple-600" />
          <h3 className="text-sm font-semibold text-gray-900">Oportunidades</h3>
          {activeOpportunities.length > 0 && (
            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
              {activeOpportunities.length}
            </span>
          )}
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
        >
          <Plus className="w-3 h-3" />
          Nova
        </button>
      </div>

      {/* Lista de Oportunidades */}
      {activeOpportunities.length === 0 ? (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-center">
          <Briefcase className="w-8 h-8 text-purple-400 mx-auto mb-2" />
          <p className="text-xs text-purple-600 mb-2">Nenhuma oportunidade ativa</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="text-xs text-purple-700 hover:text-purple-800 font-medium"
          >
            Criar primeira oportunidade
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {activeOpportunities.slice(0, 3).map((opportunity) => (
            <div
              key={opportunity.id}
              className="bg-white border border-gray-200 rounded-lg p-3 hover:border-purple-300 transition-colors"
            >
              {/* Título e Status */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-gray-900 truncate">
                    {opportunity.title}
                  </h4>
                  {opportunity.description && (
                    <p className="text-xs text-gray-500 truncate mt-0.5">
                      {opportunity.description}
                    </p>
                  )}
                </div>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(opportunity.status)}`}>
                  Aberta
                </span>
              </div>

              {/* Informações Compactas */}
              <div className="flex items-center gap-4 text-xs">
                {/* Valor */}
                {opportunity.value > 0 && (
                  <div className="flex items-center gap-1 text-green-600">
                    <DollarSign className="w-3 h-3" />
                    <span className="font-semibold">{formatCurrency(opportunity.value)}</span>
                  </div>
                )}

                {/* Probabilidade */}
                <div className="flex items-center gap-1 text-blue-600">
                  <TrendingUp className="w-3 h-3" />
                  <span className="font-medium">{opportunity.probability}%</span>
                </div>

                {/* Data Prevista */}
                {opportunity.expected_close_date && (
                  <div className="text-gray-500">
                    Prev: {new Date(opportunity.expected_close_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Link para ver todas */}
          {opportunities.length > 3 && (
            <button
              className="w-full text-xs text-purple-600 hover:text-purple-700 font-medium py-2"
            >
              Ver todas ({opportunities.length})
            </button>
          )}
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
