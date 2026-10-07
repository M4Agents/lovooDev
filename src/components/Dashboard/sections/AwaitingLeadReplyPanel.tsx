import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Clock, AlertTriangle, RefreshCw, ChevronDown,
  MessageCircle, CheckCircle, Loader2,
} from 'lucide-react'
import { useDashboardEntityActions } from '../../../hooks/dashboard/useDashboardEntityActions'
import { useDismissAlert } from '../../../hooks/dashboard/useDismissAlert'
import ChatModalSimple from '../../SalesFunnel/ChatModalSimple'
import type {
  AwaitingLeadReplyItem,
  AwaitingLeadReplyMeta,
  SlaAlertSeverity,
  DismissAlertPayload,
} from '../../../types/dashboard'

interface Props {
  data:        AwaitingLeadReplyItem[]
  meta:        AwaitingLeadReplyMeta | null
  loading:     boolean
  error:       string | null
  companyId?:  string | null
  onRetry?:    () => void
  onLoadMore?: () => void
}

const SEVERITY: Record<SlaAlertSeverity, { label: string; cls: string; bg: string }> = {
  critical: { label: 'Crítico', cls: 'text-red-700 bg-red-50 border-red-200', bg: 'border-l-red-500' },
  high:     { label: 'Alto',    cls: 'text-orange-700 bg-orange-50 border-orange-200', bg: 'border-l-orange-400' },
  medium:   { label: 'Médio',   cls: 'text-amber-700 bg-amber-50 border-amber-200', bg: 'border-l-amber-400' },
  low:      { label: 'Baixo',   cls: 'text-blue-700 bg-blue-50 border-blue-200', bg: 'border-l-blue-400' },
}

function fmtHours(h: number): string {
  if (h < 24) return `${h.toFixed(0)}h`
  return `${(h / 24).toFixed(1)}d`
}

export function AwaitingLeadReplyPanel({
  data, meta, loading, error, companyId, onRetry, onLoadMore,
}: Props) {
  const total = meta?.total ?? 0
  const hasMore = meta?.has_more ?? false
  const actions = useDashboardEntityActions({ companyId })
  const { dismiss, undo } = useDismissAlert()
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set())
  const [dismissingKey, setDismissingKey] = useState<string | null>(null)

  const handleDismiss = useCallback(async (item: AwaitingLeadReplyItem) => {
    const key = item.last_outbound_message_id
    const payload: DismissAlertPayload = {
      entity_type: 'conversation',
      entity_id: item.conversation_id,
      alert_kind: 'awaiting_lead_reply',
      last_inbound_message_id: item.last_outbound_message_id,
    }
    setDismissedKeys(prev => new Set([...prev, key]))
    setDismissingKey(key)
    const result = await dismiss(payload)
    setDismissingKey(null)
    if (!result) {
      setDismissedKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      toast.error('Não foi possível dispensar o alerta')
      return
    }
    const dismissalId = result.id
    toast((t) => (
      <div className="flex items-center gap-3 text-sm">
        <span className="text-gray-700">Alerta dispensado</span>
        <button
          className="text-indigo-600 font-semibold hover:text-indigo-800"
          onClick={() => {
            toast.dismiss(t.id)
            void (async () => {
              setDismissedKeys(prev => {
                const next = new Set(prev)
                next.delete(key)
                return next
              })
              const ok = await undo(dismissalId)
              if (!ok) {
                setDismissedKeys(prev => new Set([...prev, key]))
                toast.error('Não foi possível desfazer a dispensa')
              }
            })()
          }}
        >
          Desfazer
        </button>
      </div>
    ), { duration: 5000 })
  }, [dismiss, undo])

  const visible = data.filter(item => !dismissedKeys.has(item.last_outbound_message_id))

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-500" />
            <h3 className="text-sm font-semibold text-gray-800">Aguardando retorno do lead</h3>
            {total > 0 && (
              <span className="text-xs bg-indigo-50 text-indigo-600 border border-indigo-200 px-2 py-0.5 rounded-full font-semibold">
                {total}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            O vendedor enviou a mensagem e o lead ainda não respondeu, do mais antigo para o mais recente. O selo Crítico marca quem passou do prazo configurado.
          </p>
        </div>
        {onRetry && (
          <button onClick={onRetry} className="text-gray-400 hover:text-gray-600">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="p-4">
        {loading && data.length === 0 && (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-lg" />)}
          </div>
        )}

        {!loading && error && data.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className="text-xs text-gray-500">{error}</p>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
              <span className="text-emerald-600 text-lg">✓</span>
            </div>
            <p className="text-xs text-gray-500">Nenhum lead aguardando retorno.</p>
          </div>
        )}

        {visible.length > 0 && (
          <div className="space-y-2">
            {visible.map(item => {
              const cfg = SEVERITY[item.severity]
              const isDismissing = dismissingKey === item.last_outbound_message_id
              return (
                <div
                  key={item.conversation_id}
                  className={`flex items-center gap-3 p-3 rounded-lg border border-l-4 ${cfg.bg} border-gray-100`}
                >
                  <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold border ${cfg.cls}`}>
                    {cfg.label}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 truncate">{item.lead_name}</p>
                    {item.seller_name && (
                      <p className="text-[10px] text-gray-400 truncate">{item.seller_name}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs font-bold text-gray-500 whitespace-nowrap">
                    {fmtHours(item.hours_waiting)} sem retorno
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Abrir chat"
                      onClick={() => {
                        const id = Number(item.lead_id)
                        if (Number.isFinite(id)) actions.openChat(id)
                      }}
                      className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
                    >
                      <MessageCircle size={14} />
                    </button>
                    <button
                      type="button"
                      title="Marcar como analisado"
                      disabled={isDismissing}
                      onClick={() => void handleDismiss(item)}
                      className="p-1 rounded text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                    >
                      {isDismissing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                    </button>
                  </div>
                </div>
              )
            })}
            {(hasMore || loading) && (
              <button
                onClick={onLoadMore}
                disabled={loading}
                className="w-full mt-2 flex items-center justify-center gap-1 py-2 text-xs text-indigo-600 font-medium disabled:opacity-50"
              >
                {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ChevronDown className="w-3 h-3" />}
                {loading ? 'Carregando…' : `Carregar mais (${total - data.length} restantes)`}
              </button>
            )}
          </div>
        )}
      </div>

      {actions.chatLeadId != null && actions.companyId && actions.userId && (
        <ChatModalSimple
          isOpen={actions.chatOpen}
          onClose={actions.closeChat}
          leadId={actions.chatLeadId}
          companyId={actions.companyId}
          userId={actions.userId}
        />
      )}
    </div>
  )
}
