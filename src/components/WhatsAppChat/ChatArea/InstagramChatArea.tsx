// =====================================================
// InstagramChatArea
// =====================================================
// Área de mensagens do canal Instagram.
// Completamente separado do ChatArea (WhatsApp).
//
// Funcionalidades:
//   - Exibir thread de mensagens
//   - Hover menu: Responder / Reagir
//   - Barra de reply acima do input
//   - Bubble de citação (reply_to snapshot)
//   - Pills de reações abaixo da mensagem
//   - Reaction picker (6 emojis Meta)
// =====================================================

import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type {
  InstagramChatMessage,
  InstagramChatConversation,
  InstagramReactPayload,
  InstagramSendMediaPayload,
} from '../../../types/instagram-chat'
import { InstagramMessageInput } from './InstagramMessageInput'

// =====================================================
// CONSTANTES
// =====================================================

const REACTION_EMOJIS: Array<{ slug: 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like'; label: string }> = [
  { slug: 'love',  label: '❤️' },
  { slug: 'haha',  label: '😆' },
  { slug: 'wow',   label: '😮' },
  { slug: 'sad',   label: '😢' },
  { slug: 'angry', label: '😠' },
  { slug: 'like',  label: '👍' },
]

const EMOJI_LABEL: Record<string, string> = {
  love:  '❤️',
  haha:  '😆',
  wow:   '😮',
  sad:   '😢',
  angry: '😠',
  like:  '👍',
}

// =====================================================
// TIPOS
// =====================================================

export interface InstagramChatAreaProps {
  conversation: InstagramChatConversation
  messages: InstagramChatMessage[]
  messagesLoading: boolean
  messagesError: string | undefined
  sendLoading: boolean
  sendMediaLoading: boolean
  sendError: string | undefined
  replyingTo: InstagramChatMessage | null
  onSetReplyingTo: (msg: InstagramChatMessage | null) => void
  onSendMessage: (text: string, replyToIgMessageId?: string | null) => Promise<void>
  onSendMedia: (payload: InstagramSendMediaPayload) => Promise<void>
  onReactToMessage: (payload: InstagramReactPayload) => Promise<void>
  onRetryLoadMessages: () => void
  onClearSendError: () => void
  connectionActive: boolean
  companyId: string
}

// =====================================================
// SUB-COMPONENTE: QuotedBubble
// =====================================================

interface QuotedBubbleProps {
  content: string | null
  direction: 'inbound' | 'outbound' | null
  isInsideBubble?: boolean
}

const QuotedBubble: React.FC<QuotedBubbleProps> = ({ content, direction, isInsideBubble = false }) => {
  const isOut = direction === 'outbound'
  return (
    <div
      className={`mb-1.5 px-3 py-1.5 rounded-lg text-xs border-l-2 ${
        isInsideBubble
          ? isOut
            ? 'border-pink-200 bg-pink-600/20 text-pink-100'
            : 'border-slate-400 bg-slate-100 text-slate-600'
          : 'border-pink-400 bg-pink-50 text-slate-500'
      }`}
    >
      <p className="line-clamp-2 italic">{content ?? 'Mensagem'}</p>
    </div>
  )
}

// =====================================================
// SUB-COMPONENTE: ReactionPills
// =====================================================

interface ReactionPillsProps {
  reactions: InstagramChatMessage['reactions']
  isOutbound: boolean
  onToggle: (emoji: 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like') => void
}

const ReactionPills: React.FC<ReactionPillsProps> = ({ reactions, isOutbound, onToggle }) => {
  if (!reactions.length) return null

  // Agrupar por emoji
  const groups: Record<string, number> = {}
  for (const r of reactions) {
    if (!r.emoji) continue
    groups[r.emoji] = (groups[r.emoji] ?? 0) + 1
  }

  return (
    <div className={`flex flex-wrap gap-1 mt-1 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      {Object.entries(groups).map(([emoji, count]) => (
        <button
          key={emoji}
          onClick={() => onToggle(emoji as 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like')}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-white border border-slate-200 rounded-full text-xs shadow-sm hover:bg-slate-50 transition-colors"
          title={`${EMOJI_LABEL[emoji] ?? emoji} · ${count}`}
        >
          <span>{EMOJI_LABEL[emoji] ?? emoji}</span>
          {count > 1 && <span className="text-slate-500">{count}</span>}
        </button>
      ))}
    </div>
  )
}

// =====================================================
// SUB-COMPONENTE: ReactionPicker
// =====================================================

interface ReactionPickerProps {
  onSelect: (emoji: 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like') => void
}

const ReactionPicker: React.FC<ReactionPickerProps> = ({ onSelect }) => (
  <div className="flex items-center gap-1 bg-white rounded-full shadow-lg border border-slate-200 px-2 py-1.5 z-50">
    {REACTION_EMOJIS.map(({ slug, label }) => (
      <button
        key={slug}
        onClick={() => onSelect(slug)}
        className="text-lg hover:scale-125 transition-transform duration-100"
        title={slug}
      >
        {label}
      </button>
    ))}
  </div>
)

// =====================================================
// SUB-COMPONENTE: MessageBubble
// =====================================================

interface MessageBubbleProps {
  message: InstagramChatMessage
  onReply: (msg: InstagramChatMessage) => void
  onReact: (msg: InstagramChatMessage, emoji: 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like') => void
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onReply, onReact }) => {
  const isOutbound = message.direction === 'outbound'
  const [showActions, setShowActions]       = useState(false)
  const [showPicker, setShowPicker]         = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  // Fechar picker ao clicar fora
  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const handleReact = (emoji: 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like') => {
    setShowPicker(false)
    setShowActions(false)
    onReact(message, emoji)
  }

  const bubbleContent = () => {
    if (message.message_type === 'unsupported') {
      return <p className="text-sm italic opacity-70">Mídia não suportada</p>
    }
    if (message.message_type === 'text') {
      return (
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </p>
      )
    }
    // Mídia
    if (message.media_url) {
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-sm underline ${isOutbound ? 'text-pink-100' : 'text-blue-600'}`}
        >
          [{message.message_type}]
        </a>
      )
    }
    return <p className="text-sm italic opacity-70">[{message.message_type}]</p>
  }

  return (
    <div
      className={`group flex mb-3 items-end gap-1 ${isOutbound ? 'flex-row-reverse' : 'flex-row'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { if (!showPicker) setShowActions(false) }}
    >
      {/* Bubble */}
      <div className={`relative max-w-[72%]`}>
        <div
          className={`px-4 py-2.5 rounded-2xl shadow-sm ${
            isOutbound
              ? 'bg-pink-500 text-white rounded-br-sm'
              : 'bg-white text-slate-800 rounded-bl-sm border border-slate-100'
          }`}
        >
          {/* Bloco de citação (reply_to) */}
          {message.reply_to_ig_message_id && (
            <QuotedBubble
              content={message.reply_to_content}
              direction={message.reply_to_direction}
              isInsideBubble
            />
          )}

          {bubbleContent()}

          <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-pink-100' : 'text-slate-400'}`}>
            {formatTime(message.timestamp)}
            {isOutbound && (
              <span className="ml-1">
                {message.status === 'sending' ? '⏳' : message.status === 'failed' ? '✕' : '✓'}
              </span>
            )}
          </p>
        </div>

        {/* Reaction pills */}
        <ReactionPills
          reactions={message.reactions ?? []}
          isOutbound={isOutbound}
          onToggle={(emoji) => onReact(message, emoji)}
        />
      </div>

      {/* Hover action buttons */}
      <div
        className={`flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-100 ${
          isOutbound ? 'items-end' : 'items-start'
        }`}
      >
        {/* Reaction picker trigger */}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setShowPicker(p => !p)}
            className="w-7 h-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center text-base hover:bg-slate-50 transition-colors"
            title="Reagir"
          >
            😊
          </button>
          {showPicker && (
            <div className={`absolute bottom-9 ${isOutbound ? 'right-0' : 'left-0'} z-50`}>
              <ReactionPicker onSelect={handleReact} />
            </div>
          )}
        </div>

        {/* Reply button */}
        <button
          onClick={() => { setShowActions(false); onReply(message) }}
          className="w-7 h-7 rounded-full bg-white border border-slate-200 shadow-sm flex items-center justify-center hover:bg-slate-50 transition-colors"
          title="Responder"
        >
          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const InstagramChatArea: React.FC<InstagramChatAreaProps> = ({
  conversation,
  messages,
  messagesLoading,
  messagesError,
  sendLoading,
  sendMediaLoading,
  sendError,
  replyingTo,
  onSetReplyingTo,
  onSendMessage,
  onSendMedia,
  onReactToMessage,
  onRetryLoadMessages,
  onClearSendError,
  connectionActive,
  companyId,
}) => {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll para o fim ao carregar/receber mensagens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleReact = useCallback(async (
    msg: InstagramChatMessage,
    emoji: 'love' | 'haha' | 'wow' | 'sad' | 'angry' | 'like'
  ) => {
    await onReactToMessage({ ig_message_id: msg.ig_message_id, emoji, action: 'react' })
  }, [onReactToMessage])

  const displayName =
    conversation.participant_name ||
    (conversation.participant_username ? `@${conversation.participant_username}` : t('instagram.participantUnknown'))

  // ── Header ──────────────────────────────────────────

  const Header = (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200/60 bg-white/90 backdrop-blur-sm">
      {conversation.participant_avatar ? (
        <img
          src={conversation.participant_avatar}
          alt={displayName}
          className="w-10 h-10 rounded-full object-cover"
        />
      ) : (
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
          style={{ background: 'radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)' }}
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-slate-800 truncate">{displayName}</h3>
        {conversation.participant_username && (
          <p className="text-xs text-slate-500">@{conversation.participant_username}</p>
        )}
      </div>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-700">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
        Instagram
      </span>
    </div>
  )

  // ── Connection inactive banner ──────────────────────

  const InactiveBanner = !connectionActive && (
    <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200 text-amber-800 text-sm">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span>{t('instagram.connectionInactiveBanner')}</span>
      <button
        onClick={() => navigate('/settings?tab=integracoes&integration=instagram')}
        className="ml-auto text-amber-700 underline text-xs font-medium"
      >
        {t('instagram.reconnectLink')}
      </button>
    </div>
  )

  // ── Loading state ────────────────────────────────────

  if (messagesLoading) {
    return (
      <div className="flex flex-col h-full">
        {Header}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-slate-200 border-t-pink-500 mx-auto mb-3"></div>
            <p className="text-slate-500 text-sm">{t('instagram.loadingMessages')}</p>
          </div>
        </div>
      </div>
    )
  }

  // ── Error state ──────────────────────────────────────

  if (messagesError) {
    return (
      <div className="flex flex-col h-full">
        {Header}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center p-8">
            <div className="mx-auto h-12 w-12 bg-red-100 rounded-full flex items-center justify-center mb-3">
              <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-slate-600 mb-3">{t('instagram.errorLoadMessages')}</p>
            <button
              onClick={onRetryLoadMessages}
              className="px-4 py-2 bg-pink-500 text-white rounded-lg text-sm hover:bg-pink-600 transition-colors"
            >
              {t('instagram.retryLoad')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Layout principal ─────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-pink-50/20 to-white">
      {Header}
      {InactiveBanner}

      {/* Thread de mensagens */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-slate-400 text-sm italic">Nenhuma mensagem ainda</p>
          </div>
        ) : (
          messages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={{ ...msg, reactions: msg.reactions ?? [] }}
              onReply={onSetReplyingTo}
              onReact={handleReact}
            />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Send error banner */}
      {sendError && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-t border-red-200 text-red-700 text-sm">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="flex-1">{sendError}</span>
          <button onClick={onClearSendError} className="text-red-500 hover:text-red-700 ml-1">✕</button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-slate-200/60 bg-white/90 backdrop-blur-sm px-4 pt-2 pb-3">
        <InstagramMessageInput
          conversationId={conversation.id}
          companyId={companyId}
          sendLoading={sendLoading}
          sendMediaLoading={sendMediaLoading}
          connectionActive={connectionActive}
          replyingTo={replyingTo}
          onSetReplyingTo={onSetReplyingTo}
          onSend={onSendMessage}
          onSendMedia={onSendMedia}
        />
        <p className="text-[10px] text-slate-400 mt-1.5 text-center">
          Instagram Direct · Janela de resposta: 24h
        </p>
      </div>
    </div>
  )
}

export default InstagramChatArea
