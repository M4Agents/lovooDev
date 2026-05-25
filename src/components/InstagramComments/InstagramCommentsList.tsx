// =====================================================
// InstagramCommentsList — lista de comentários no sidebar
// =====================================================

import React from 'react'
import { useTranslation } from 'react-i18next'
import { CommentCard } from './CommentCard'
import type { InstagramComment } from '../../types/instagram-comments'

interface InstagramCommentsListProps {
  comments: InstagramComment[]
  loading: boolean
  error?: string
  selectedCommentId?: string
  onSelectComment: (id: string) => void
  onRefresh: () => void
}

export const InstagramCommentsList: React.FC<InstagramCommentsListProps> = ({
  comments,
  loading,
  error,
  selectedCommentId,
  onSelectComment,
  onRefresh,
}) => {
  const { t } = useTranslation('chat')

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-2 border-pink-500 border-t-transparent mx-auto mb-3" />
          <p className="text-sm text-slate-500">{t('instagram.comments.loading')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center py-12 px-4">
        <div className="text-center">
          <p className="text-sm text-red-500 mb-3">{error}</p>
          <button
            onClick={onRefresh}
            className="text-xs text-pink-600 underline hover:text-pink-700"
          >
            {t('instagram.comments.retry')}
          </button>
        </div>
      </div>
    )
  }

  if (comments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-12 px-4">
        <div className="text-center">
          <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center">
            <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-slate-700">{t('instagram.comments.emptyTitle')}</p>
          <p className="text-xs text-slate-500 mt-1">{t('instagram.comments.emptyHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {comments.map(comment => (
        <CommentCard
          key={comment.id}
          comment={comment}
          isSelected={comment.id === selectedCommentId}
          onSelect={onSelectComment}
        />
      ))}
    </div>
  )
}

export default InstagramCommentsList
