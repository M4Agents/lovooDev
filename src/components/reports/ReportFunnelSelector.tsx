import React, { useRef, useEffect, useState } from 'react'
import { ChevronDown, Check, Layers } from 'lucide-react'
import type { SalesFunnelOption } from '../../hooks/useReports'

interface ReportFunnelSelectorProps {
  options: SalesFunnelOption[]
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
  loading?: boolean
}

export const ReportFunnelSelector: React.FC<ReportFunnelSelectorProps> = ({
  options,
  selected,
  onToggle,
  onClear,
  loading = false,
}) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const label =
    selected.length === 0
      ? 'Todos os funis'
      : selected.length === 1
      ? (options.find((o) => o.id === selected[0])?.name ?? '1 funil')
      : `${selected.length} funis selecionados`

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
      >
        <Layers className="w-4 h-4 text-gray-500 shrink-0" />
        <span className={`font-medium max-w-[160px] truncate ${selected.length > 0 ? 'text-blue-700' : 'text-gray-700'}`}>
          {label}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
          {/* Todos */}
          <button
            onClick={onClear}
            className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
              selected.length === 0
                ? 'bg-blue-50 text-blue-700 font-medium'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span>Todos os funis</span>
            {selected.length === 0 && <Check className="w-4 h-4" />}
          </button>

          {options.length > 0 && (
            <div className="border-t border-gray-100 mt-1 pt-1">
              {options.map((opt) => {
                const isSelected = selected.includes(opt.id)
                return (
                  <button
                    key={opt.id}
                    onClick={() => onToggle(opt.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                      isSelected
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="truncate">{opt.name}</span>
                    {isSelected && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}

          {options.length === 0 && !loading && (
            <p className="px-3 py-2 text-xs text-gray-400">Nenhum funil encontrado</p>
          )}
        </div>
      )}
    </div>
  )
}
