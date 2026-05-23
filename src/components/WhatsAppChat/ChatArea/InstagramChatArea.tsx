// =====================================================
// InstagramChatArea
// =====================================================
// Área de mensagens do canal Instagram.
// Completamente separado do ChatArea (WhatsApp).
//
// Recebe props do hook useInstagramChatData.
// =====================================================

import React, { useRef, useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type {
  InstagramChatMessage,
  InstagramChatConversation,
} from '../../../types/instagram-chat'

// =====================================================
// TIPOS
// =====================================================

export interface InstagramChatAreaProps {
  conversation: InstagramChatConversation
  messages: InstagramChatMessage[]
  messagesLoading: boolean
  messagesError: string | undefined
  sendLoading: boolean
  sendError: string | undefined
  onSendMessage: (text: string) => Promise<void>
  onRetryLoadMessages: () => void
  onClearSendError: () => void
  connectionActive: boolean
}

// =====================================================
// SUB-COMPONENTE: Bubble de mensagem
// =====================================================

interface MessageBubbleProps {
  message: InstagramChatMessage
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isOutbound = message.direction === 'outbound'

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    } catch {
      return ''
    }
  }

  if (message.message_type === 'text' || message.message_type === 'unsupported') {
    return (
      <div className={`flex mb-3 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[72%] px-4 py-2.5 rounded-2xl shadow-sm ${
            isOutbound
              ? 'bg-pink-500 text-white rounded-br-sm'
              : 'bg-white text-slate-800 rounded-bl-sm border border-slate-100'
          }`}
        >
          {message.message_type === 'unsupported' ? (
            <p className="text-sm italic opacity-70">Mídia não suportada</p>
          ) : (
            <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
              {message.content}
            </p>
          )}
          <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-pink-100' : 'text-slate-400'}`}>
            {formatTime(message.timestamp)}
            {isOutbound && (
              <span className="ml-1">
                {message.status === 'sending' ? '⏳' : '✓'}
              </span>
            )}
          </p>
        </div>
      </div>
    )
  }

  // Mídia (image/video/audio/file) — MVP: exibir link ou placeholder
  return (
    <div className={`flex mb-3 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[72%] px-4 py-2.5 rounded-2xl shadow-sm ${
          isOutbound
            ? 'bg-pink-500 text-white rounded-br-sm'
            : 'bg-white text-slate-800 rounded-bl-sm border border-slate-100'
        }`}
      >
        {message.media_url ? (
          <a
            href={message.media_url}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-sm underline ${isOutbound ? 'text-pink-100' : 'text-blue-600'}`}
          >
            [{message.message_type}]
          </a>
        ) : (
          <p className="text-sm italic opacity-70">[{message.message_type}]</p>
        )}
        <p className={`text-[10px] mt-1 text-right ${isOutbound ? 'text-pink-100' : 'text-slate-400'}`}>
          {formatTime(message.timestamp)}
        </p>
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
  sendError,
  onSendMessage,
  onRetryLoadMessages,
  onClearSendError,
  connectionActive,
}) => {
  const { t } = useTranslation('chat')
  const navigate = useNavigate()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef       = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')

  // Scroll para o fim ao carregar/receber mensagens
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || sendLoading || !connectionActive) return
    setText('')
    await onSendMessage(trimmed)
    inputRef.current?.focus()
  }, [text, sendLoading, connectionActive, onSendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

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
      {/* Badge canal */}
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

  // ── Send error banner ───────────────────────────────

  const SendErrorBanner = sendError && (
    <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border-t border-red-200 text-red-700 text-sm">
      <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
      <span className="flex-1">{sendError}</span>
      <button onClick={onClearSendError} className="text-red-500 hover:text-red-700 ml-1">✕</button>
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
          messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Banner de erro de envio */}
      {SendErrorBanner}

      {/* Input de texto */}
      <div className="border-t border-slate-200/60 bg-white/90 backdrop-blur-sm px-4 py-3">
        {!connectionActive ? (
          <div className="text-center text-sm text-amber-600 py-2">
            {t('instagram.errorConnectionInactive')}
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('instagram.inputPlaceholder')}
              rows={1}
              disabled={sendLoading}
              className="flex-1 resize-none px-4 py-2.5 bg-slate-100 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:bg-white transition-all max-h-32 overflow-y-auto disabled:opacity-50"
              style={{ minHeight: '42px' }}
            />
            <button
              onClick={handleSend}
              disabled={!text.trim() || sendLoading}
              className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-pink-500 to-pink-600 text-white rounded-xl flex items-center justify-center hover:from-pink-600 hover:to-pink-700 disabled:opacity-40 transition-all duration-200 shadow-sm"
              title={t('instagram.sendButton')}
            >
              {sendLoading ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              )}
            </button>
          </div>
        )}
        <p className="text-[10px] text-slate-400 mt-1 text-center">
          Instagram Direct · Janela de resposta: 24h
        </p>
      </div>
    </div>
  )
}

export default InstagramChatArea
