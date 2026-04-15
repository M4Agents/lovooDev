// Seção "Histórico de Entradas" — exibida no detalhe do lead.
// Consome GET /api/leads/:id/entries?company_id=...
// Ordenado: mais recente primeiro.

import React, { useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, Clock } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface LeadEntry {
  id: string
  source: string
  origin_channel: string | null
  external_event_id: string | null
  created_at: string
  metadata: Record<string, unknown>
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
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export const LeadEntriesSection: React.FC<LeadEntriesSectionProps> = ({ leadId, companyId }) => {
  const [entries, setEntries] = useState<LeadEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!leadId || !companyId) return

    const fetchEntries = async () => {
      setLoading(true)
      setError(null)

      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
          setError('Sessão expirada')
          return
        }

        const res = await fetch(`/api/leads/${leadId}/entries?company_id=${companyId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })

        if (!res.ok) {
          setError('Erro ao carregar histórico de entradas')
          return
        }

        const json = await res.json()
        setEntries(json.entries || [])
      } catch {
        setError('Erro de conexão')
      } finally {
        setLoading(false)
      }
    }

    fetchEntries()
  }, [leadId, companyId])

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        {[1, 2].map(i => (
          <div key={i} className="h-12 bg-gray-100 rounded-lg" />
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

  if (entries.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400">
        <Clock className="w-7 h-7 mx-auto mb-2 opacity-40" />
        <p className="text-sm">Nenhuma entrada registrada</p>
        <p className="text-xs mt-1">As entradas serão registradas nas próximas interações</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100"
        >
          <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-gray-800">
                {SOURCE_LABELS[entry.source] ?? entry.source}
              </span>
              {entry.origin_channel && (
                <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">
                  {entry.origin_channel}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{formatDate(entry.created_at)}</p>
            {entry.metadata && Object.keys(entry.metadata).length > 0 && (() => {
              const { lock_failed, new_lead_id, ...rest } = entry.metadata as Record<string, unknown>
              void lock_failed
              void new_lead_id
              const displayKeys = Object.keys(rest).filter(k => rest[k] !== null && rest[k] !== undefined)
              if (displayKeys.length === 0) return null
              return (
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {displayKeys.slice(0, 3).map(k => `${k}: ${String(rest[k])}`).join(' · ')}
                </p>
              )
            })()}
          </div>
        </div>
      ))}
    </div>
  )
}
