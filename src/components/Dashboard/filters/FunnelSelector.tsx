// =====================================================
// FunnelSelector
// Dropdown de seleção de funil para o Dashboard.
// Visível apenas quando a empresa possui múltiplos funis.
//
// Props:
//   funnelId    — valor atual (do useDashboardFilters)
//   onSelect    — callback para setFunnelId
//
// Dados:
//   Internamente usa useFunnels() para buscar a lista.
//
// Comportamento:
//   Ao carregar a lista, se funnelId for nulo ou pertencer
//   a outra empresa (ID não encontrado na lista), seleciona
//   automaticamente o funil com is_default=true ou o primeiro.
// =====================================================

import React, { useRef, useState, useEffect } from 'react'
import { ChevronDown, GitBranch } from 'lucide-react'
import { useFunnels } from '../../../hooks/dashboard/useFunnels'
import type { FunnelItem } from '../../../services/dashboardApi'

interface FunnelSelectorProps {
  funnelId: string | null
  onSelect: (id: string | null) => void
}

export const FunnelSelector: React.FC<FunnelSelectorProps> = ({ funnelId, onSelect }) => {
  const { funnels, loading } = useFunnels()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-seleção do funil padrão:
  // Dispara quando funnelId está ausente ou não pertence à empresa atual.
  // Prioridade: is_default=true → primeiro da lista.
  useEffect(() => {
    if (loading || funnels.length === 0) return

    const isCurrentValid = funnels.some((f) => f.id === funnelId)
    if (isCurrentValid) return

    const defaultFunnel = funnels.find((f) => f.is_default) ?? funnels[0]
    if (defaultFunnel) {
      onSelect(defaultFunnel.id)
    }
  }, [loading, funnels, funnelId, onSelect])

  const selected: FunnelItem | undefined = funnels.find((f) => f.id === funnelId)

  const handleSelect = (funnel: FunnelItem) => {
    onSelect(funnel.id)
    setOpen(false)
  }

  // Não renderiza se só houver um funil ou nenhum
  if (!loading && funnels.length <= 1) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors',
          'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          !funnelId ? 'text-gray-400' : '',
        ].join(' ')}
      >
        <GitBranch className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="max-w-[160px] truncate">
          {loading
            ? 'Carregando...'
            : selected
            ? selected.name
            : 'Selecionar funil'}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !loading && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-lg py-1">
          {funnels.map((funnel) => (
            <button
              key={funnel.id}
              type="button"
              onClick={() => handleSelect(funnel)}
              className={[
                'w-full text-left px-4 py-2 text-sm transition-colors truncate',
                funnel.id === funnelId
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {funnel.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
