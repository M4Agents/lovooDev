// =====================================================
// COMPONENTE: LeadCard (ATUALIZADO PARA OPORTUNIDADES)
// Data: 03/03/2026 - Atualizado: 04/03/2026
// Objetivo: Card arrastável da oportunidade no Kanban
// =====================================================

import { Draggable } from '@hello-pangea/dnd'
import { User, Phone, Building2, Tag, DollarSign, Calendar, Briefcase } from 'lucide-react'
import type { OpportunityFunnelPosition } from '../../types/sales-funnel'
import { formatCurrency, formatDaysInStage } from '../../types/sales-funnel'

interface LeadCardProps {
  position: OpportunityFunnelPosition
  index: number
  visibleFields?: string[]
  leadPhotos?: Record<string, string>
  onClick?: (leadId: number) => void
}

export const LeadCard: React.FC<LeadCardProps> = ({
  position,
  index,
  visibleFields = ['photo', 'name', 'phone', 'company', 'tags'],
  leadPhotos,
  onClick
}) => {
  const opportunity = position.opportunity
  const lead = opportunity?.lead
  
  if (!lead || !opportunity) return null

  const handleClick = () => {
    if (onClick) {
      onClick(lead.id)
    }
  }

  const isFieldVisible = (field: string) => visibleFields.includes(field)

  return (
    <Draggable draggableId={`lead-${lead.id}`} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={handleClick}
          className={`
            bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-3
            cursor-pointer transition-all duration-200
            hover:shadow-md hover:border-blue-300
            ${snapshot.isDragging ? 'shadow-lg ring-2 ring-blue-400 rotate-2' : ''}
          `}
        >
          {/* Header com foto e nome */}
          <div className="flex items-start gap-3 mb-3">
            {isFieldVisible('photo') && (
              <div className="flex-shrink-0">
                {(() => {
                  // Buscar foto do lead via leadPhotos (mapeamento por telefone)
                  const phoneKey = lead.phone ? lead.phone.replace(/\D/g, '') : ''
                  const photoUrl = phoneKey && leadPhotos ? leadPhotos[phoneKey] : undefined
                  
                  if (photoUrl) {
                    return (
                      <img
                        src={photoUrl}
                        alt={lead.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    )
                  }
                  return (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <User className="w-5 h-5 text-white" />
                    </div>
                  )
                })()}
              </div>
            )}

            <div className="flex-1 min-w-0">
              {/* Título da Oportunidade (NOVO) */}
              <div className="flex items-center gap-1.5 mb-1">
                <Briefcase className="w-3.5 h-3.5 text-purple-600" />
                <h3 className="font-semibold text-gray-900 truncate text-sm">
                  {opportunity.title}
                </h3>
              </div>
              
              {/* Nome do Lead */}
              {isFieldVisible('name') && (
                <p className="text-xs text-gray-600 truncate">
                  👤 {lead.name}
                </p>
              )}
              
              {isFieldVisible('email') && lead.email && (
                <p className="text-xs text-gray-500 truncate">
                  {lead.email}
                </p>
              )}
            </div>
          </div>

          {/* Informações do lead */}
          <div className="space-y-2">
            {isFieldVisible('phone') && lead.phone && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Phone className="w-3.5 h-3.5 text-gray-400" />
                <span className="truncate">{lead.phone}</span>
              </div>
            )}

            {isFieldVisible('company') && lead.company_name && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Building2 className="w-3.5 h-3.5 text-gray-400" />
                <span className="truncate">{lead.company_name}</span>
              </div>
            )}

            {/* Valor da Oportunidade (ATUALIZADO) */}
            {isFieldVisible('deal_value') && opportunity.value > 0 && (
              <div className="flex items-center gap-2 text-xs font-semibold text-green-600">
                <DollarSign className="w-3.5 h-3.5" />
                <span>{formatCurrency(opportunity.value)}</span>
              </div>
            )}

            {isFieldVisible('origin') && lead.origin && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                  {lead.origin}
                </span>
              </div>
            )}

            {/* Último Contato */}
            {isFieldVisible('last_contact_at') && lead.last_contact_at && (
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <span>Último contato: {new Date(lead.last_contact_at).toLocaleDateString('pt-BR')}</span>
              </div>
            )}
          </div>

          {/* Tags */}
          {isFieldVisible('tags') && lead.tags && lead.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-3">
              {lead.tags.slice(0, 3).map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs"
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
              {lead.tags.length > 3 && (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                  +{lead.tags.length - 3}
                </span>
              )}
            </div>
          )}

          {/* Footer com tempo na etapa */}
          {position.days_in_stage !== undefined && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <Calendar className="w-3.5 h-3.5" />
                <span>{formatDaysInStage(position.days_in_stage)}</span>
              </div>
              
              {isFieldVisible('created_at') && lead.created_at && (
                <span className="text-xs text-gray-400">
                  {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Draggable>
  )
}
