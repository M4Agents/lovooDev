// =====================================================
// CommentCard — item individual na lista de comentários
// =====================================================

import React from 'react'
import { CommentStatusBadge } from './CommentStatusBadge'
import type { InstagramComment } from '../../types/instagram-comments'

interface CommentCardProps {
  comment: InstagramComment
  isSelected: boolean
  onSelect: (id: string) => void
}

function formatRelativeTime(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)  return 'Agora'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)   return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7)     return `${days}d`
  return new Date(timestamp).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export const CommentCard: React.FC<CommentCardProps> = ({ comment, isSelected, onSelect }) => {
  const initials = (comment.ig_username ?? '?').slice(0, 2).toUpperCase()

  return (
    <button
      onClick={() => onSelect(comment.id)}
      className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-pink-300 ${
        isSelected ? 'bg-pink-50 border-l-2 border-l-pink-500' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
          {initials}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-sm font-semibold text-slate-800 truncate">
              @{comment.ig_username ?? 'usuário'}
            </span>
            <span className="text-xs text-slate-400 flex-shrink-0">
              {formatRelativeTime(comment.timestamp)}
            </span>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed line-clamp-2 mb-1.5">
            {comment.content}
          </p>

          <CommentStatusBadge
            status={comment.status}
            privateReplySent={comment.private_reply_sent}
          />
        </div>
      </div>
    </button>
  )
}

export default CommentCard
