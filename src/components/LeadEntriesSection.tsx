// Histórico unificado: entradas CRM + visitas Track (timeline paginada)

import React, { useCallback, useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, Clock, Eye, Megaphone } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface TimelineItem {
  item_type: 'entry' | 'visit' | string
  item_id: string
  created_at: string
  source: string | null
  origin_channel: string | null
  visitor_id: string | null
  session_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  referrer: string | null
  device_type: string | null
  metadata: Record<string, unknown> | null
}

interface TimelineSummary {
  entry_count: number
  visit_count: number
  visits_before_conversion: number
  first_visit_at: string | null
  first_entry_at: string | null
  visitor_id: string | null
}

interface LeadEntriesSectionProps {
  leadId: number
  companyId: string
}

const SOURCE_LABELS: Record<string, string> = {
  webhook: 'Webhook',
  whatsapp: 'WhatsApp',
  import: 'Importação',
  manual: 'Manual',
  instagram: 'Instagram',
  visit: 'Visita',
}

const PAGE_SIZE = 20

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function utmBits(item: TimelineItem): string[] {
  const bits: string[] = []
  if (item.utm_source) bits.push(item.utm_source)
  if (item.utm_medium) bits.push(item.utm_medium)
  if (item.utm_campaign) bits.push(item.utm_campaign)
  if (item.utm_content) bits.push(item.utm_content)
  if (item.utm_term) bits.push(item.utm_term)
  return bits
}

export const LeadEntriesSection: React.FC<LeadEntriesSectionProps> = ({ leadId, companyId }) => {
  const [items, setItems] = useState<TimelineItem[]>([])
  const [summary, setSummary] = useState<TimelineSummary | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPage = useCallback(
    async (pageToLoad: number, append: boolean) => {
      if (!leadId || !companyId) return

      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!session) {
          setError('Sessão expirada')
          return
        }

        const res = await fetch(
          `/api/leads/${leadId}/timeline?company_id=${companyId}&page=${pageToLoad}&limit=${PAGE_SIZE}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        )

        if (!res.ok) {
          setError('Erro ao carregar histórico de track')
          return
        }

        const json = await res.json()
        const nextItems: TimelineItem[] = json.items || []
        setItems((prev) => (append ? [...prev, ...nextItems] : nextItems))
        setSummary(json.summary || null)
        setTotal(Number(json.total || 0))
        setHasMore(Boolean(json.has_more))
        setPage(pageToLoad)
      } catch {
        setError('Erro de conexão')
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [leadId, companyId]
  )

  useEffect(() => {
    fetchPage(1, false)
  }, [fetchPage])

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-14 bg-gray-100 rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-500 py-3">
        <AlertCircle className="w-4 h-4 flex-shrink-0" />
        <span>{error}</span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400">
        <Clock className="w-7 h-7 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Nenhum histórico de track/entrada</p>
        <p className="text-xs mt-1">Visitas e conversões aparecerão aqui quando houver visitor_id</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {summary && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-1">
          <p>
            <span className="font-medium text-slate-800">{summary.visit_count}</span> visita(s) ·{' '}
            <span className="font-medium text-slate-800">{summary.entry_count}</span> entrada(s) no CRM
          </p>
          <p>
            <span className="font-medium text-slate-800">{summary.visits_before_conversion}</span>{' '}
            acesso(s) à LP antes da conversão
          </p>
        </div>
      )}

      <div className="space-y-2">
        {items.map((item) => {
          const isVisit = item.item_type === 'visit'
          const label = isVisit
            ? 'Visita'
            : SOURCE_LABELS[item.source || ''] ?? item.source ?? 'Entrada'
          const bits = utmBits(item)

          return (
            <div
              key={`${item.item_type}-${item.item_id}`}
              className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100"
            >
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  isVisit ? 'bg-sky-100' : 'bg-amber-100'
                }`}
              >
                {isVisit ? (
                  <Eye className="w-3.5 h-3.5 text-sky-600" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-800">{label}</span>
                  {bits.slice(0, 1).map((b) => (
                    <span
                      key={b}
                      className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600"
                    >
                      {b}
                    </span>
                  ))}
                  {bits.length > 1 && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Megaphone className="w-3 h-3" />
                      {bits.slice(1).join(' · ')}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{formatDate(item.created_at)}</p>
                {(item.referrer || item.device_type) && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {[item.device_type, item.referrer && item.referrer !== 'direct' ? item.referrer : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-gray-400">
          Mostrando {items.length} de {total}
        </p>
        {hasMore && (
          <button
            type="button"
            onClick={() => fetchPage(page + 1, true)}
            disabled={loadingMore}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            {loadingMore ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </div>
    </div>
  )
}
