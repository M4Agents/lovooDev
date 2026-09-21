// =============================================================================
// MetaChatArea — MVP3C.4
//
// Área de leitura de mensagens Meta WhatsApp. READ-ONLY.
//
// Responsabilidade:
//   - Exibir header da conversa (contact_name / wa_id / status)
//   - Listar mensagens em ordem cronológica recebida do hook
//   - Distinguir inbound / outbound via estilo + data-direction
//   - Estados: loading, error (+ retry), empty, mensagens
//   - Scroll para o final ao carregar mensagens
//
// Fora do escopo:
//   - Envio de mensagens (MVP3D)
//   - Realtime (MVP3E)
//   - LeadPanel, templates, sugestões de IA
//   - Paginação histórica
//
// Isolamento:
//   - Zero imports Uazapi
//   - Zero acesso Supabase
//   - Zero composer/input/textarea
// =============================================================================

import { useRef, useEffect }                   from 'react'
import { useMetaChatMessages }                  from '../../../hooks/chat/useMetaChatMessages'
import type { MetaChatConversation, MetaChatMessage } from '../../../types/meta-whatsapp'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formata timestamp ISO para HH:mm local.
 * Retorna string vazia se o valor for nulo, indefinido ou inválido.
 * Exportada para permitir teste unitário direto sem renderização.
 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Gera iniciais para avatar local — sem fetch de imagem. */
function getInitials(name: string | null | undefined, fallback: string): string {
  const src = (name || fallback).trim()
  if (!src) return '?'
  const parts = src.split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return src.substring(0, 2).toUpperCase()
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface MetaChatAreaProps {
  companyId:      string
  conversationId: string
  conversation:   MetaChatConversation | undefined
}

// ── Header ────────────────────────────────────────────────────────────────────

interface MetaChatHeaderProps {
  conversation: MetaChatConversation | undefined
}

function MetaChatHeader({ conversation }: MetaChatHeaderProps) {
  const displayName = conversation?.contact_name || conversation?.wa_id || '—'
  const waId        = conversation?.wa_id ?? ''
  const status      = conversation?.status
  const initials    = getInitials(conversation?.contact_name, conversation?.wa_id ?? '?')

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200/60 shadow-sm flex-shrink-0">
      {/* Avatar por iniciais — sem requisição externa */}
      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
        <span className="text-white text-sm font-semibold select-none">{initials}</span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-800 truncate leading-tight">{displayName}</p>
        {/* wa_id como identificador secundário — omitido quando igual ao displayName */}
        {waId && waId !== displayName && (
          <p className="text-xs text-slate-500 truncate">{waId}</p>
        )}
      </div>

      {status && (
        <span
          data-status={status}
          className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
            status === 'active'
              ? 'bg-green-100 text-green-700'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {status}
        </span>
      )}
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

interface MetaMessageBubbleProps {
  message: MetaChatMessage
}

function MetaMessageBubble({ message }: MetaMessageBubbleProps) {
  const isInbound = message.direction === 'inbound'
  const time      = formatTime(message.provider_timestamp ?? message.created_at)

  return (
    <div
      data-direction={message.direction}
      className={`flex mb-2 ${isInbound ? 'justify-start' : 'justify-end'}`}
    >
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 shadow-sm ${
          isInbound
            ? 'bg-white text-slate-800 rounded-tl-sm border border-slate-200/60'
            : 'bg-blue-500 text-white rounded-tr-sm'
        }`}
      >
        {message.message_type === 'text' ? (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
            {message.body}
          </p>
        ) : (
          <p className="text-sm italic opacity-70">
            Mensagem não suportada
          </p>
        )}

        {time && (
          <p
            className={`text-[10px] mt-1 text-right leading-none ${
              isInbound ? 'text-slate-400' : 'text-blue-100'
            }`}
          >
            {time}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export function MetaChatArea({ companyId, conversationId, conversation }: MetaChatAreaProps) {
  const { messages, loading, error, refresh } = useMetaChatMessages(companyId, conversationId)

  // Scroll para o final quando as mensagens carregam ou mudam.
  // scrollTop = scrollHeight: comportamento simples e síncrono, sem smooth, sem timeout.
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  return (
    <div className="flex flex-col h-full bg-white/60 backdrop-blur-sm">
      {/* Header — sempre presente, mesmo com conversation undefined */}
      <MetaChatHeader conversation={conversation} />

      {/* Área de mensagens — flex-1 + overflow-y-auto */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-4 py-3 bg-gradient-to-b from-slate-50/40 to-white/40"
      >
        {loading ? (
          /* Estado: carregando */
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-blue-500 border-t-transparent" />
              <p className="text-sm text-slate-500">Carregando mensagens...</p>
            </div>
          </div>
        ) : error ? (
          /* Estado: erro */
          <div className="flex items-center justify-center h-full">
            <div className="text-center p-6 max-w-xs">
              <p className="text-sm text-red-600 mb-4 leading-relaxed">{error}</p>
              <button
                type="button"
                onClick={refresh}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          /* Estado: sem mensagens */
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-500">Nenhuma mensagem nesta conversa</p>
          </div>
        ) : (
          /* Estado: lista de mensagens — ordem cronológica conforme recebida do hook */
          messages.map(msg => (
            <MetaMessageBubble key={msg.id} message={msg} />
          ))
        )}
      </div>

      {/*
        READ-ONLY — sem composer, sem input, sem textarea, sem contentEditable.
        Envio de mensagens: escopo MVP3D.
      */}
    </div>
  )
}
