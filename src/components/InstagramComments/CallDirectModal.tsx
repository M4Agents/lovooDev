// =====================================================
// CallDirectModal — modal para "Chamar no Direct"
// =====================================================
// Ação INDEPENDENTE da resposta pública.
// NÃO altera status do comentário.
// NÃO navega automaticamente para a DM.

import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CallDirectModalProps {
  igUsername: string | null
  loading: boolean
  error?: string
  onSubmit: (text: string) => Promise<void>
  onClose: () => void
}

export const CallDirectModal: React.FC<CallDirectModalProps> = ({
  igUsername,
  loading,
  error,
  onSubmit,
  onClose,
}) => {
  const { t } = useTranslation('chat')
  const [text, setText] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || loading) return
    await onSubmit(trimmed)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-800">
              {t('instagram.comments.actions.callDirect')}
            </h3>
            {igUsername && (
              <p className="text-sm text-slate-500 mt-0.5">@{igUsername}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 leading-relaxed">
          {t('instagram.comments.callDirectHint')}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t('instagram.comments.callDirectPlaceholder')}
            rows={4}
            disabled={loading}
            className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent disabled:opacity-60 placeholder:text-slate-400 mb-4"
          />

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 text-sm text-slate-600 border border-slate-200 rounded-xl py-2.5 hover:bg-slate-50 transition-colors disabled:opacity-60"
            >
              {t('instagram.comments.cancel')}
            </button>
            <button
              type="submit"
              disabled={loading || !text.trim()}
              className="flex-1 flex items-center justify-center gap-2 text-sm font-medium bg-blue-600 text-white rounded-xl py-2.5 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
                </svg>
              )}
              {t('instagram.comments.actions.callDirect')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CallDirectModal
