// =====================================================
// COMPONENTE: FunnelSelector
// Data: 03/03/2026
// Objetivo: Dropdown para selecionar funil
// =====================================================

import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Plus, Check, GripVertical } from 'lucide-react'
import type { SalesFunnel } from '../../types/sales-funnel'

interface FunnelSelectorProps {
  funnels: SalesFunnel[]
  selectedFunnel?: SalesFunnel
  onSelectFunnel: (funnelId: string) => void
  onCreateFunnel?: () => void
  onReorderFunnels?: (funnels: Array<{id: string, display_order: number}>) => Promise<void>
}

export const FunnelSelector: React.FC<FunnelSelectorProps> = ({
  funnels,
  selectedFunnel,
  onSelectFunnel,
  onCreateFunnel,
  onReorderFunnels
}) => {
  const { t } = useTranslation('funnel')
  const [isOpen, setIsOpen] = useState(false)
  const [draggedFunnel, setDraggedFunnel] = useState<SalesFunnel | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelectFunnel = (funnelId: string) => {
    onSelectFunnel(funnelId)
    setIsOpen(false)
  }

  const handleDragStart = (e: React.DragEvent, funnel: SalesFunnel) => {
    e.dataTransfer.effectAllowed = 'move'
    setDraggedFunnel(funnel)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    
    if (!draggedFunnel || !onReorderFunnels) return

    const currentIndex = activeFunnels.findIndex(f => f.id === draggedFunnel.id)
    
    if (currentIndex === dropIndex) {
      setDraggedFunnel(null)
      setDragOverIndex(null)
      return
    }

    // Reordenar localmente
    const newFunnels = [...activeFunnels]
    newFunnels.splice(currentIndex, 1)
    newFunnels.splice(dropIndex, 0, draggedFunnel)

    // Atualizar display_order
    const updatedFunnels = newFunnels.map((funnel, index) => ({
      id: funnel.id,
      display_order: index
    }))

    try {
      await onReorderFunnels(updatedFunnels)
    } catch (error) {
      console.error('Error reordering funnels:', error)
    } finally {
      setDraggedFunnel(null)
      setDragOverIndex(null)
    }
  }

  const activeFunnels = funnels.filter(f => f.is_active)

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 flex-1">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="font-medium text-gray-900">
            {selectedFunnel?.name || t('selector.placeholder')}
          </span>
          {selectedFunnel?.is_default && (
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
              {t('selector.defaultBadge')}
            </span>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
          <div className="p-2 border-b border-gray-100">
            <p className="text-xs text-gray-500 px-2 py-1">
              {t('selector.hint')}
            </p>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {activeFunnels.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-sm text-gray-500 mb-4">
                  {t('selector.noFunnels')}
                </p>
                {onCreateFunnel && (
                  <button
                    onClick={() => {
                      onCreateFunnel()
                      setIsOpen(false)
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    {t('selector.createFirstFunnel')}
                  </button>
                )}
              </div>
            ) : (
              activeFunnels.map((funnel, index) => (
                <div
                  key={funnel.id}
                  draggable={!!onReorderFunnels}
                  onClick={() => handleSelectFunnel(funnel.id)}
                  onDragStart={(e) => handleDragStart(e, funnel)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  className={`
                    w-full flex items-center justify-between p-3 rounded-lg transition-all cursor-pointer
                    ${selectedFunnel?.id === funnel.id 
                      ? 'bg-blue-50 border border-blue-200' 
                      : 'hover:bg-gray-50'
                    }
                    ${draggedFunnel?.id === funnel.id ? 'opacity-50' : ''}
                    ${dragOverIndex === index ? 'border-t-2 border-blue-500' : ''}
                  `}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {onReorderFunnels && (
                      <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                    <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-medium text-gray-900 truncate">
                        {funnel.name}
                      </p>
                      {funnel.description && (
                        <p className="text-xs text-gray-500 truncate">
                          {funnel.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        {funnel.is_default && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                            {t('selector.defaultBadge')}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {new Date(funnel.created_at).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  </div>
                  {selectedFunnel?.id === funnel.id && (
                    <Check className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  )}
                </div>
              ))
            )}
          </div>

          {onCreateFunnel && activeFunnels.length > 0 && (
            <div className="p-2 border-t border-gray-100">
              <button
                onClick={() => {
                  onCreateFunnel()
                  setIsOpen(false)
                }}
                className="w-full flex items-center gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors text-blue-600"
              >
                <Plus className="w-4 h-4" />
                <span className="font-medium text-sm">{t('selector.createNew')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
