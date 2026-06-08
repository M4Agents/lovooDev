import React, { useState, useRef, useEffect } from 'react'
import { SlidersHorizontal, RotateCcw } from 'lucide-react'
import type { LeadColumnDef } from '../hooks/useLeadTablePreferences'
import { MAX_VISIBLE_COLUMNS } from '../hooks/useLeadTablePreferences'

interface LeadTableColumnCustomizerProps {
  visibleColumns: string[]
  allColumns: LeadColumnDef[]
  onToggle: (id: string) => void
  onReset: () => void
  isAtLimit: boolean
}

export const LeadTableColumnCustomizer: React.FC<LeadTableColumnCustomizerProps> = ({
  visibleColumns,
  allColumns,
  onToggle,
  onReset,
  isAtLimit,
}) => {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  // Fechar ao clicar fora
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const staticCols = allColumns.filter((c) => !c.isCustom)
  const customCols = allColumns.filter((c) => c.isCustom)

  const searchLower = search.toLowerCase()

  const filteredStatic = staticCols.filter((c) =>
    c.label.toLowerCase().includes(searchLower)
  )
  const filteredCustom = customCols.filter((c) =>
    c.label.toLowerCase().includes(searchLower)
  )

  const noResults = filteredStatic.length === 0 && filteredCustom.length === 0

  const renderCheckbox = (col: LeadColumnDef) => {
    const isVisible = visibleColumns.includes(col.id)
    const disabled = isAtLimit && !isVisible

    return (
      <label
        key={col.id}
        className={`flex items-center gap-2.5 px-3 py-1.5 rounded cursor-pointer transition-colors ${
          disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'
        }`}
        title={
          disabled
            ? `Limite de ${MAX_VISIBLE_COLUMNS} colunas atingido. Oculte uma coluna para adicionar outra.`
            : undefined
        }
      >
        <input
          type="checkbox"
          checked={isVisible}
          disabled={disabled}
          onChange={() => !disabled && onToggle(col.id)}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
        />
        <span className="text-sm text-gray-700 select-none">{col.label}</span>
      </label>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Botão trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
          open
            ? 'bg-blue-50 border-blue-300 text-blue-700'
            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
        }`}
        title="Configurar colunas visíveis"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span>Colunas</span>
        <span className={`text-xs font-semibold ${isAtLimit ? 'text-orange-500' : 'text-gray-400'}`}>
          {visibleColumns.length}/{MAX_VISIBLE_COLUMNS}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-lg shadow-lg w-64 flex flex-col">
          {/* Busca */}
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              placeholder="Buscar coluna..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm px-2.5 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>

          {/* Lista de colunas */}
          <div className="overflow-y-auto max-h-72 py-1">
            {noResults ? (
              <p className="text-xs text-gray-400 text-center py-4">
                Nenhum campo encontrado
              </p>
            ) : (
              <>
                {/* Campos padrão */}
                {filteredStatic.length > 0 && (
                  <div>
                    <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                      Campos padrão
                    </p>
                    {filteredStatic.map(renderCheckbox)}
                  </div>
                )}

                {/* Campos personalizados */}
                {filteredCustom.length > 0 && (
                  <div className={filteredStatic.length > 0 ? 'mt-1' : ''}>
                    <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                      Campos personalizados
                    </p>
                    {filteredCustom.map(renderCheckbox)}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-3 py-2.5 border-t border-gray-100 bg-gray-50 rounded-b-lg">
            <span className={`text-xs font-medium ${isAtLimit ? 'text-orange-500' : 'text-gray-500'}`}>
              {visibleColumns.length} / {MAX_VISIBLE_COLUMNS} colunas
            </span>
            <button
              onClick={() => { onReset(); setSearch('') }}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Restaurar padrão
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
