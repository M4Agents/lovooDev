// =====================================================
// COMPONENTE: LeadCard (ATUALIZADO PARA OPORTUNIDADES)
// Data: 03/03/2026 - Atualizado: 04/03/2026
// Tags inline: 01/04/2026
// Objetivo: Card arrastável da oportunidade no Kanban
// =====================================================

import React, { useState, useRef } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import { Phone, Building2, Tag, DollarSign, Calendar, Briefcase, TrendingUp, Plus } from 'lucide-react'
import { Avatar } from '../Avatar'
import { TagSelectorPopover } from '../TagSelectorPopover'
import type { OpportunityFunnelPosition } from '../../types/sales-funnel'
import { formatCurrency, formatDaysInStage } from '../../types/sales-funnel'
import { resolvePhotoUrl } from '../../utils/imageUtils'

interface LeadCardProps {
  position: OpportunityFunnelPosition
  index: number
  visibleFields?: string[]
  onClick?: (leadId: number) => void
  /** Necessário para TagSelectorPopover (multi-tenant). */
  companyId?: string
}

export const LeadCard: React.FC<LeadCardProps> = ({
  position,
  index,
  visibleFields = ['photo', 'name', 'phone', 'company', 'tags'],
  onClick,
  companyId
}) => {
  const opportunity = position.opportunity
  const lead = opportunity?.lead

  // Override local de tags: atualizado após edição inline sem disparar boardRefresh.
  // Reseta automaticamente na próxima remontagem do card (boardRefresh/Realtime/navegação).
  const [localTagNames, setLocalTagNames] = useState<string[] | null>(null)
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const tagButtonRef = useRef<HTMLButtonElement>(null)

  if (!lead || !opportunity) return null

  const displayTags = localTagNames ?? lead.tags ?? []

  const handleClick = () => {
    if (onClick) onClick(lead.id)
  }

  const isFieldVisible = (field: string) => visibleFields.includes(field)

  const handleTagsChanged = (names: string[]) => {
    setLocalTagNames(names)
  }

  const handleOpenTagPopover = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (companyId) setTagPopoverOpen(true)
  }

  return (
    <>
    <Draggable draggableId={`opportunity-${position.opportunity_id}`} index={index}>
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
                <Avatar
                  src={resolvePhotoUrl(lead.profile_picture_url)}
                  alt={lead.name}
                  size="md"
                />
              </div>
            )}

            <div className="flex-1 min-w-0">
              {/* Título da Oportunidade */}
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

            {/* Valor da Oportunidade com Probabilidade */}
            {isFieldVisible('deal_value') && opportunity.value > 0 && (
              <div className="flex items-center gap-2 text-xs font-semibold text-green-600">
                <DollarSign className="w-3.5 h-3.5" />
                <span>{formatCurrency(opportunity.value)}</span>
                {isFieldVisible('probability') && opportunity.probability && (
                  <div className="flex items-center gap-1 text-blue-600">
                    <TrendingUp className="w-3 h-3" />
                    <span className="font-medium">{opportunity.probability}%</span>
                  </div>
                )}
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
          {isFieldVisible('tags') && (
            <div className="flex flex-wrap items-center gap-1 mt-3">
              {displayTags.slice(0, 3).map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs"
                >
                  <Tag className="w-3 h-3" />
                  {tag}
                </span>
              ))}
              {displayTags.length > 3 && (
                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
                  +{displayTags.length - 3}
                </span>
              )}

              {/* Botão de editar tags — protegido contra DnD e abertura do modal */}
              {companyId && (
                <button
                  ref={tagButtonRef}
                  type="button"
                  onMouseDown={e => e.stopPropagation()}
                  onClick={handleOpenTagPopover}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  title="Gerenciar tags"
                >
                  <Plus className="w-3 h-3" />
                </button>
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

    {/* Popover renderizado via createPortal — fora do fluxo do card para evitar overflow clipping */}
    {tagPopoverOpen && companyId && (
      <TagSelectorPopover
        leadId={lead.id}
        companyId={companyId}
        anchorRef={tagButtonRef}
        onTagsChanged={handleTagsChanged}
        onClose={() => setTagPopoverOpen(false)}
      />
    )}
    </>
  )
}
