// =====================================================
// CommentLeadPanel — painel direito para comentários
// =====================================================
// Exibe lead vinculado ao comentário ou botão para converter.

import React from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { InstagramComment } from '../../types/instagram-comments'
import type { CreateCommentLeadPayload, CreateCommentLeadResponse } from '../../types/instagram-comments'

interface CommentLeadPanelProps {
  comment: InstagramComment
  createLeadLoading: boolean
  createLeadError?: string
  onCreateLead: (commentId: string, payload: CreateCommentLeadPayload) => Promise<CreateCommentLeadResponse | null>
  onClearError: () => void
}

export const CommentLeadPanel: React.FC<CommentLeadPanelProps> = ({
  comment,
  createLeadLoading,
  createLeadError,
  onCreateLead,
  onClearError,
}) => {
  const { t }    = useTranslation('chat')
  const navigate = useNavigate()

  if (comment.lead_id) {
    return (
      <div className="p-6">
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-purple-800">{t('instagram.leadLinked')}</span>
          </div>
          <button
            onClick={() => navigate(`/leads?lead_id=${comment.lead_id}`)}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium bg-purple-600 text-white py-2.5 rounded-xl hover:bg-purple-700 transition-colors"
          >
            {t('instagram.viewLead')}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-400 to-indigo-500 flex items-center justify-center shadow-md">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-slate-700 mb-1">{t('instagram.noLeadLinked')}</p>
        <p className="text-xs text-slate-500 mb-4">{t('instagram.comments.convertLeadHint')}</p>
      </div>
    </div>
  )
}

export default CommentLeadPanel
