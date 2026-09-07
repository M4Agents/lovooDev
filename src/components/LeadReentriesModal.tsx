import React, { useEffect, useState, useCallback } from 'react'
import { X, Loader2, RefreshCw, User, Phone, Mail, ArrowUpDown } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'

interface LeadReentry {
  lead_id: number
  lead_name: string
  lead_phone: string | null
  lead_email: string | null
  reentry_count: number
  last_entry_at: string
}

interface LeadReentriesModalProps {
  isOpen: boolean
  onClose: () => void
  onLeadClick: (leadId: number) => void
  periodLabel: string
  dateRange?: { start: string; end: string }
  tagIds?: string[]
  filters?: {
    status?: string
    origin?: string
    responsibleUserId?: string
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function LeadReentriesModal({
  isOpen,
  onClose,
  onLeadClick,
  periodLabel,
  dateRange,
  tagIds,
  filters,
}: LeadReentriesModalProps) {
  const { company } = useAuth()
  const [items, setItems] = useState<LeadReentry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    if (!company?.id) return
    setLoading(true)
    setError(null)
    try {
      const data = await api.getLeadReentriesList(
        company.id,
        dateRange,
        tagIds?.length ? tagIds : undefined,
        filters
      )
      setItems(data as unknown as LeadReentry[])
    } catch (err: any) {
      setError('Erro ao carregar reentradas. Tente novamente.')
      console.error('[LeadReentriesModal] erro:', err)
    } finally {
      setLoading(false)
    }
  }, [company?.id, dateRange, tagIds, filters])

  useEffect(() => {
    if (isOpen) load()
  }, [isOpen, load])

  // Fechar com Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const filtered = search.trim()
    ? items.filter(item =>
        item.lead_name?.toLowerCase().includes(search.toLowerCase()) ||
        item.lead_phone?.includes(search) ||
        item.lead_email?.toLowerCase().includes(search.toLowerCase())
      )
    : items

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-orange-500" />
              Leads com Reentrada
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {periodLabel} · {items.length} lead{items.length !== 1 ? 's' : ''} voltaram
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-3 pb-2">
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou e-mail..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-sm text-red-600">{error}</p>
              <button
                onClick={load}
                className="mt-3 text-xs text-blue-600 hover:underline"
              >
                Tentar novamente
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <RefreshCw className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {search ? 'Nenhum lead encontrado com esse filtro.' : 'Nenhuma reentrada no período selecionado.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm mt-2">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left py-2 font-medium">Lead</th>
                  <th className="text-left py-2 font-medium hidden sm:table-cell">Contato</th>
                  <th className="text-center py-2 font-medium">
                    <span className="flex items-center justify-center gap-1">
                      <ArrowUpDown className="w-3 h-3" />
                      Reentradas
                    </span>
                  </th>
                  <th className="text-right py-2 font-medium hidden md:table-cell">Última entrada</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map(item => (
                  <tr
                    key={item.lead_id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => onLeadClick(item.lead_id)}
                  >
                    {/* Nome */}
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                          <User className="w-3.5 h-3.5 text-orange-500" />
                        </div>
                        <span className="font-medium text-gray-800 line-clamp-1">
                          {item.lead_name || '—'}
                        </span>
                      </div>
                    </td>

                    {/* Contato */}
                    <td className="py-3 pr-4 hidden sm:table-cell">
                      <div className="text-gray-500 space-y-0.5">
                        {item.lead_phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="w-3 h-3 flex-shrink-0" />
                            <span className="text-xs">{item.lead_phone}</span>
                          </div>
                        )}
                        {item.lead_email && (
                          <div className="flex items-center gap-1">
                            <Mail className="w-3 h-3 flex-shrink-0" />
                            <span className="text-xs truncate max-w-[160px]">{item.lead_email}</span>
                          </div>
                        )}
                        {!item.lead_phone && !item.lead_email && (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </div>
                    </td>

                    {/* Reentradas */}
                    <td className="py-3 text-center">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 text-xs font-bold">
                        {item.reentry_count}×
                      </span>
                    </td>

                    {/* Última entrada */}
                    <td className="py-3 text-right text-xs text-gray-400 hidden md:table-cell">
                      {formatDate(item.last_entry_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {!loading && filtered.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {filtered.length !== items.length
                ? `${filtered.length} de ${items.length} lead${items.length !== 1 ? 's' : ''}`
                : `${items.length} lead${items.length !== 1 ? 's' : ''} com reentrada`}
            </p>
            <button
              onClick={onClose}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              Fechar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
