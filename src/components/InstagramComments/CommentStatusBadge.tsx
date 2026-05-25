// =====================================================
// CommentStatusBadge — badge visual de status do comentário
// =====================================================

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { InstagramCommentStatus } from '../../types/instagram-comments'

interface CommentStatusBadgeProps {
  status: InstagramCommentStatus
  privateReplySent?: boolean
  className?: string
}

const STATUS_CONFIG: Record<InstagramCommentStatus, { label: string; className: string }> = {
  pending:          { label: 'status.pending',         className: 'bg-amber-100 text-amber-700 border-amber-200' },
  replied:          { label: 'status.replied',         className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  hidden:           { label: 'status.hidden',          className: 'bg-slate-100 text-slate-500 border-slate-200' },
  ignored:          { label: 'status.ignored',         className: 'bg-slate-100 text-slate-400 border-slate-200' },
  converted_to_lead:{ label: 'status.convertedToLead', className: 'bg-purple-100 text-purple-700 border-purple-200' },
}

export const CommentStatusBadge: React.FC<CommentStatusBadgeProps> = ({
  status,
  privateReplySent = false,
  className = '',
}) => {
  const { t } = useTranslation('chat')
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending

  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${className}`}>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
        {t(`instagram.comments.${config.label}`)}
      </span>
      {privateReplySent && (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-100 text-blue-700 border-blue-200">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
          </svg>
          {t('instagram.comments.directSent')}
        </span>
      )}
    </span>
  )
}

export default CommentStatusBadge
