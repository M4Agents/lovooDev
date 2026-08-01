import React from 'react'
import { Search, LayoutGrid, LayoutList, X } from 'lucide-react'
import type { CompanyFilters, Plan, ViewMode, StatusFilter, TypeFilter } from './companiesTypes'

interface Props {
  filters:          CompanyFilters
  onFiltersChange:  (f: CompanyFilters) => void
  viewMode:         ViewMode
  onViewModeChange: (m: ViewMode) => void
  availablePlans:   Plan[]
  totalCount:       number
  filteredCount:    number
}

export const CompaniesFilter: React.FC<Props> = ({
  filters, onFiltersChange,
  viewMode, onViewModeChange,
  availablePlans, totalCount, filteredCount,
}) => {
  const set = <K extends keyof CompanyFilters>(key: K, value: CompanyFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value })

  const hasActiveFilters =
    filters.search   !== '' ||
    filters.status   !== 'all' ||
    filters.planSlug !== '' ||
    filters.type     !== 'all'

  const clearFilters = () =>
    onFiltersChange({ search: '', status: 'all', planSlug: '', type: 'all' })

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">

        {/* Busca por nome / domínio */}
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome ou domínio..."
            value={filters.search}
            onChange={e => set('search', e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>

        {/* Status */}
        <select
          value={filters.status}
          onChange={e => set('status', e.target.value as StatusFilter)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
        >
          <option value="all">Todos os status</option>
          <option value="active">Ativo</option>
          <option value="suspended">Suspenso</option>
          <option value="cancelled">Cancelado</option>
        </select>

        {/* Plano */}
        <select
          value={filters.planSlug}
          onChange={e => set('planSlug', e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
        >
          <option value="">Todos os planos</option>
          <option value="none">Sem plano</option>
          {availablePlans.map(p => (
            <option key={p.id} value={p.slug}>{p.name}</option>
          ))}
        </select>

        {/* Tipo */}
        <select
          value={filters.type}
          onChange={e => set('type', e.target.value as TypeFilter)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
        >
          <option value="all">Todos os tipos</option>
          <option value="free">Gratuito</option>
          <option value="trial">Em trial</option>
          <option value="trial_expired">Trial expirado</option>
        </select>

        {/* Limpar filtros */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 px-2 py-2 rounded-lg hover:bg-slate-100 transition-colors"
            title="Limpar filtros"
          >
            <X className="w-4 h-4" />
            Limpar
          </button>
        )}

        <div className="flex-1" />

        {/* Toggle grade / lista */}
        <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
          <button
            onClick={() => onViewModeChange('grid')}
            className={`p-2 transition-colors ${
              viewMode === 'grid'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
            title="Visualização em grade"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={`p-2 transition-colors ${
              viewMode === 'list'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
            title="Visualização em lista"
          >
            <LayoutList className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Contador de resultados */}
      {hasActiveFilters && (
        <p className="text-xs text-slate-500">
          {filteredCount === totalCount
            ? `${totalCount} empresa${totalCount !== 1 ? 's' : ''}`
            : `${filteredCount} de ${totalCount} empresa${totalCount !== 1 ? 's' : ''}`}
        </p>
      )}
    </div>
  )
}
