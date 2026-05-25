// =====================================================
// ReplyComposer — input de resposta pública inline
// =====================================================

import React, { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'

interface ReplyComposerProps {
  onSubmit: (text: string) => Promise<boolean>
  loading: boolean
  onCancel: () => void
}

export const ReplyComposer: React.FC<ReplyComposerProps> = ({ onSubmit, loading, onCancel }) => {
  const { t } = useTranslation('chat')
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || loading) return
    const ok = await onSubmit(trimmed)
    if (ok) setText('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e as unknown as React.FormEvent)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-slate-100 bg-white p-3">
      <p className="text-xs font-medium text-slate-500 mb-2">
        {t('instagram.comments.actions.reply')}
      </p>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('instagram.comments.replyPlaceholder')}
        rows={3}
        disabled={loading}
        className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-pink-300 focus:border-transparent disabled:opacity-60 placeholder:text-slate-400"
      />
      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="text-sm text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
        >
          {t('instagram.comments.cancel')}
        </button>
        <button
          type="submit"
          disabled={loading || !text.trim()}
          className="flex items-center gap-2 text-sm font-medium bg-pink-600 text-white px-4 py-1.5 rounded-lg hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <div className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          )}
          {t('instagram.comments.actions.reply')}
        </button>
      </div>
    </form>
  )
}

export default ReplyComposer
