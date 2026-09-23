// =============================================================================
// MetaChatArea — MVP3D + MVP4A
//
// Área de mensagens Meta WhatsApp com composer de texto e templates.
//
// Responsabilidade:
//   - Exibir header da conversa (contact_name / wa_id / status)
//   - Listar mensagens em ordem cronológica recebida do hook
//   - Distinguir inbound / outbound via estilo + data-direction
//   - Estados: loading, error (+ retry), empty, mensagens
//   - Scroll para o final ao carregar mensagens
//   - Composer de texto: envio por botão ou Enter
//   - Botão Template → abre MetaTemplatePicker → envia template textual
//
// Fora do escopo:
//   - LeadPanel, sugestões de IA
//   - Paginação histórica
//   - Mídia, áudio, documentos
//
// Isolamento (invariantes de segurança):
//   - Zero wa_id/to usado para envio — destinatário resolvido pelo backend
//   - Zero imports Uazapi
//   - Zero acesso Supabase
//   - Zero optimistic append
//   - Zero console.log / secrets
//
// Anti-stale (mutation):
//   - sendGenRef: incrementado ao trocar conversationId
//   - Resultado de envio antigo não contamina conversa nova
//   - mountedRef: evita setState após unmount
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { useMetaChatMessages }  from '../../../hooks/chat/useMetaChatMessages'
import { metaWhatsAppApi }      from '../../../services/metaWhatsAppApi'
import { MetaTemplatePicker }   from './MetaTemplatePicker'
import type {
  MetaChatConversation,
  MetaChatMessage,
  MetaWhatsAppTemplate,
  MetaTemplateParameterValues,
} from '../../../types/meta-whatsapp'

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

/**
 * Formata tamanho de arquivo em bytes para exibição legível.
 * Exportada para permitir teste unitário direto.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024)            return `${bytes} B`
  if (bytes < 1024 * 1024)     return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Gera iniciais para avatar local — sem fetch de imagem. */
function getInitials(name: string | null | undefined, fallback: string): string {
  const src = (name || fallback).trim()
  if (!src) return '?'
  const parts = src.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return src.substring(0, 2).toUpperCase()
}

/**
 * Mapeia erros do backend para mensagens seguras ao usuário.
 * Nunca expõe token, wa_id, stack ou payload bruto.
 */
function getSendErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  switch (code) {
    // ── Texto ──────────────────────────────────────────────────────────────────
    case 'conversation_not_found':
      return 'Conversa não encontrada. Atualize a lista e tente novamente.'
    case 'instance_not_found':
      return 'Instância não encontrada.'
    case 'instance_not_connected':
      return 'A instância não está conectada.'
    case 'invalid_request':
      return 'Mensagem inválida. Verifique o conteúdo.'
    case 'invalid_message':
      return 'Mensagem não aceita pelo provedor.'
    case 'credential_unavailable':
      return 'Erro de configuração da instância. Contate o suporte.'
    case 'internal_error':
      return 'Erro interno ao enviar a mensagem.'
    // ── Template (MVP4A) ───────────────────────────────────────────────────────
    case 'template_not_found':
      return 'Template não encontrado. Verifique se o template foi aprovado no Meta.'
    case 'template_language_not_found':
      return 'Idioma do template não disponível. Verifique as configurações do template.'
    case 'template_unsupported':
      return 'Este template contém formatos não suportados (mídia, botões, etc.).'
    case 'template_params_mismatch':
      return 'Os parâmetros fornecidos não correspondem ao template. Verifique os campos.'
    // ── Media template (MVP4B) ─────────────────────────────────────────────────
    case 'media_header_required':
      return 'Este template requer uma mídia de cabeçalho. Selecione uma imagem, vídeo ou documento.'
    case 'media_header_unexpected':
      return 'Este template não aceita mídia de cabeçalho.'
    case 'media_asset_not_found':
      return 'Mídia não encontrada. Ela pode ter sido removida da biblioteca.'
    case 'media_asset_too_large':
      return 'O arquivo é grande demais para ser enviado por este template.'
    case 'media_asset_type_unknown':
      return 'Não foi possível identificar o tipo do arquivo de mídia.'
    case 'media_asset_type_unsupported':
      return 'Formato de arquivo não suportado pelo Meta WhatsApp.'
    case 'media_asset_type_mismatch':
      return 'O arquivo selecionado não corresponde ao tipo de mídia do template.'
    case 'media_provider_unavailable':
      return 'Serviço de mídia temporariamente indisponível. Tente novamente.'
    // ── Compartilhados ─────────────────────────────────────────────────────────
    case 'provider_unavailable':
      return 'Serviço temporariamente indisponível. Tente novamente.'
    case 'provider_error':
      return 'Não foi possível enviar a mensagem. Se a conversa estiver fora do prazo de 24h, é necessário usar um template aprovado.'
    default:
      return 'Não foi possível enviar a mensagem.'
  }
}

// ⚠ Mensagem especial: Graph pode já ter entregue a mensagem.
// Não limpar texto. Não chamar refresh. Não fazer retry automático.
const SEND_PERSISTENCE_FAILED_MSG =
  'Mensagem possivelmente enviada, mas houve falha ao registrar o envio. ' +
  'Verifique a conversa antes de tentar novamente.'

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
      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
        <span className="text-white text-sm font-semibold select-none">{initials}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-800 truncate leading-tight">{displayName}</p>
        {waId && waId !== displayName && (
          <p className="text-xs text-slate-500 truncate">{waId}</p>
        )}
      </div>
      {status && (
        <span
          data-status={status}
          className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
            status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
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
  // message_type='template': renderiza body persistido — sem reinterpolação.
  // MVP4B.6C: exibe mídia de header (IMAGE/VIDEO/DOCUMENT) acima do body.
  // Outros tipos (image, audio, etc.) continuam "Mensagem não suportada".
  const isRenderable = message.message_type === 'text' || message.message_type === 'template'

  // MVP4B.6C — Mídia de header (somente para template outbound com media)
  const hasMedia  = message.message_type === 'template' && message.media != null
  const mediaType = hasMedia ? message.media!.type : null

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
        {/* ── IMAGE header ──────────────────────────────────────────────────── */}
        {hasMedia && mediaType === 'image' && message.media!.url && (
          <div className="mb-2 -mx-3 -mt-2 rounded-t-2xl overflow-hidden">
            <img
              data-testid="msg-media-image"
              src={message.media!.url}
              alt={message.media!.filename ?? 'Imagem'}
              className="w-full max-h-48 object-contain bg-black/5"
              onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        )}

        {/* ── VIDEO header ──────────────────────────────────────────────────── */}
        {hasMedia && mediaType === 'video' && message.media!.url && (
          <div className="mb-2 -mx-3 -mt-2 rounded-t-2xl overflow-hidden">
            <video
              data-testid="msg-media-video"
              src={message.media!.url}
              controls
              preload="metadata"
              className="w-full max-h-48 bg-black/80"
            />
          </div>
        )}

        {/* ── DOCUMENT header ───────────────────────────────────────────────── */}
        {hasMedia && mediaType === 'document' && (
          <div
            data-testid="msg-media-document"
            className="mb-2 flex items-center gap-2 p-2 rounded-lg bg-black/10"
          >
            <span aria-hidden="true" className="text-lg flex-shrink-0">📄</span>
            <span className="text-xs font-medium truncate flex-1">
              {message.media!.filename ?? 'Documento'}
            </span>
            {message.media!.file_size != null && (
              <span className="text-xs opacity-70 flex-shrink-0">
                {formatFileSize(message.media!.file_size)}
              </span>
            )}
          </div>
        )}

        {/* ── Body / fallback ───────────────────────────────────────────────── */}
        {isRenderable ? (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
            {message.body}
          </p>
        ) : (
          <p className="text-sm italic opacity-70">
            Mensagem não suportada
          </p>
        )}
        {time && (
          <p className={`text-[10px] mt-1 text-right leading-none ${
            isInbound ? 'text-slate-400' : 'text-blue-100'
          }`}>
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

  // ── Composer state ──────────────────────────────────────────────────────────
  const [text, setText]               = useState('')
  const [isSending, setIsSending]     = useState(false)
  const [sendError, setSendError]     = useState<string | null>(null)
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  // ── Composer refs ───────────────────────────────────────────────────────────
  // sendingRef: guarda síncrona contra duplo envio (antes do rerender de isSending)
  const sendingRef = useRef(false)
  // mountedRef: evita setState após unmount
  const mountedRef = useRef(true)
  // sendGenRef: contador de geração — incrementado ao trocar conversationId.
  //             Impede que resultado de envio antigo contamine a nova conversa.
  const sendGenRef = useRef(0)

  // ── Mount / unmount ─────────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Scroll ao carregar/atualizar mensagens ──────────────────────────────────
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  // ── Resetar composer ao trocar de conversa ──────────────────────────────────
  // Fecha picker e incrementa sendGenRef para invalidar envios em andamento da
  // conversa anterior — evita que o resultado de A contamine B.
  useEffect(() => {
    setText('')
    setSendError(null)
    setIsPickerOpen(false)
    sendGenRef.current += 1
  }, [conversationId])

  // ── handleSend (texto) ──────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (sendingRef.current || !conversation?.instance_id || !text.trim()) return

    const textToSend = text
    const genAtSend  = sendGenRef.current

    sendingRef.current = true
    setIsSending(true)
    setSendError(null)

    let success      = false
    let caughtError: unknown = undefined

    try {
      await metaWhatsAppApi.sendMessage(
        companyId,
        conversation.instance_id,
        conversationId,
        textToSend,
      )
      success = true
    } catch (err) {
      caughtError = err
    } finally {
      sendingRef.current = false
      if (mountedRef.current) setIsSending(false)
    }

    if (!mountedRef.current || sendGenRef.current !== genAtSend) return

    if (success) {
      setText('')
      refresh()
    } else if (caughtError instanceof Error && caughtError.message === 'send_persistence_failed') {
      setSendError(SEND_PERSISTENCE_FAILED_MSG)
    } else {
      setSendError(getSendErrorMessage(caughtError))
    }
  }, [companyId, conversation, conversationId, text, refresh])

  // ── handleSendTemplate (MVP4A + MVP4B) ────────────────────────────────────
  // Reutiliza os mesmos guards anti-stale do handleSend (sendingRef, sendGenRef, mountedRef).
  // MVP4B: headerMediaAssetId — UUID do asset validado server-side.
  //   TEXT: undefined (ausente no payload).
  //   MEDIA: string (header_media_asset_id no payload).
  const handleSendTemplate = useCallback(async (
    template:            MetaWhatsAppTemplate,
    parameterValues:     MetaTemplateParameterValues,
    headerMediaAssetId?: string,
  ) => {
    if (sendingRef.current || !conversation?.instance_id) return

    const genAtSend = sendGenRef.current

    sendingRef.current = true
    setIsSending(true)
    setSendError(null)

    let success      = false
    let caughtError: unknown = undefined

    try {
      // Destinatário resolvido pelo backend via conversation_id.
      // to/wa_id/waba_id/phone_number_id NUNCA enviados pelo frontend.
      // header_media_asset_id: somente para templates com HEADER media.
      await metaWhatsAppApi.sendTemplate(
        companyId,
        conversation.instance_id,
        conversationId,
        template.name,
        template.language,
        parameterValues,
        headerMediaAssetId,
      )
      success = true
    } catch (err) {
      caughtError = err
    } finally {
      sendingRef.current = false
      if (mountedRef.current) setIsSending(false)
    }

    if (!mountedRef.current || sendGenRef.current !== genAtSend) return

    if (success) {
      setIsPickerOpen(false)
      refresh()
    } else if (caughtError instanceof Error && caughtError.message === 'send_persistence_failed') {
      setSendError(SEND_PERSISTENCE_FAILED_MSG)
    } else {
      setSendError(getSendErrorMessage(caughtError))
    }
  }, [companyId, conversation, conversationId, refresh])

  // ── handleKeyDown (Enter envia; Shift+Enter quebra linha) ───────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const canSend        = !isSending && !!conversation?.instance_id && !!text.trim()
  const canOpenPicker  = !isSending && !!conversation?.instance_id

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
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin h-8 w-8 rounded-full border-2 border-blue-500 border-t-transparent" />
              <p className="text-sm text-slate-500">Carregando mensagens...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center p-6 max-w-xs">
              <p className="text-sm text-red-600 mb-4 leading-relaxed">{error}</p>
              <button type="button" onClick={refresh}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors">
                Tentar novamente
              </button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-slate-500">Nenhuma mensagem nesta conversa</p>
          </div>
        ) : (
          messages.map(msg => <MetaMessageBubble key={msg.id} message={msg} />)
        )}
      </div>

      {/* Composer — MVP3D + MVP4A */}
      <div className="flex-shrink-0 border-t border-slate-200/60 bg-white px-4 py-3">
        {sendError && (
          <p role="alert" className="text-xs text-red-600 mb-2 leading-relaxed">
            {sendError}
          </p>
        )}
        <div className="flex items-end gap-2">
          {/* Botão Template — MVP4A */}
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            disabled={!canOpenPicker}
            aria-label="Template"
            className="flex-shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:text-blue-600 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Template
          </button>

          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!conversation?.instance_id || isSending}
            placeholder="Digite uma mensagem..."
            rows={1}
            aria-label="Mensagem"
            className="flex-1 resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Enviar"
            className="flex-shrink-0 rounded-xl bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Enviar
          </button>
        </div>
      </div>

      {/* Template picker overlay — MVP4A */}
      {conversation?.instance_id && (
        <MetaTemplatePicker
          companyId={companyId}
          instanceId={conversation.instance_id}
          open={isPickerOpen}
          sending={isSending}
          onClose={() => setIsPickerOpen(false)}
          onSend={handleSendTemplate}
        />
      )}
    </div>
  )
}
