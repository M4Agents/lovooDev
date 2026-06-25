// =====================================================
// InstagramCommentDetail — painel central de comentário
// =====================================================
// Exibe conteúdo completo do comentário + hierarquia de ações:
//   Primary:   Responder
//   Secondary: Chamar no Direct
//   Success:   Converter em Lead
//   Danger:    Ocultar
//   Neutral:   Ignorar
//
// ISOLAMENTO: nunca usa instagram_messages, InstagramChatArea,
// useInstagramChatData ou tipos de DM.

import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { CommentStatusBadge } from './CommentStatusBadge'
import { ReplyComposer } from './ReplyComposer'
import { CallDirectModal } from './CallDirectModal'
import { ConvertLeadModal } from './ConvertLeadModal'
import type { InstagramComment } from '../../types/instagram-comments'
import type { UseInstagramCommentsDataReturn } from '../../hooks/instagram/useInstagramCommentsData'

interface InstagramCommentDetailProps {
  comment: InstagramComment
  commentsData: UseInstagramCommentsDataReturn
  onOpenConversation?: (conversationId: string) => void
}

export const InstagramCommentDetail: React.FC<InstagramCommentDetailProps> = ({
  comment,
  commentsData,
  onOpenConversation,
}) => {
  const { t }    = useTranslation('chat')
  const navigate = useNavigate()

  const [showReply,           setShowReply]           = useState(false)
  const [showCallDirectModal, setShowCallDirectModal] = useState(false)
  const [showConvertModal,    setShowConvertModal]    = useState(false)
  const [confirmHide,         setConfirmHide]         = useState(false)

  const {
    actionLoading, actionError, clearActionError,
    replyComment, hideComment, ignoreComment, callDirect,
    createLead, createLeadLoading, createLeadError, clearCreateLeadError,
  } = commentsData

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleReply = useCallback(async (text: string) => {
    const ok = await replyComment(comment.id, { text })
    if (ok) {
      toast.success(t('instagram.comments.toastReplied'))
      setShowReply(false)
    } else {
      toast.error(actionError ?? t('instagram.comments.errors.generic'))
    }
    return ok
  }, [comment.id, replyComment, actionError, t])

  const handleHide = useCallback(async () => {
    const ok = await hideComment(comment.id)
    if (ok) {
      toast.success(t('instagram.comments.toastHidden'))
      setConfirmHide(false)
    } else {
      toast.error(actionError ?? t('instagram.comments.errors.generic'))
    }
  }, [comment.id, hideComment, actionError, t])

  const handleIgnore = useCallback(async () => {
    const ok = await ignoreComment(comment.id)
    if (ok) toast(t('instagram.comments.toastIgnored'))
    else toast.error(actionError ?? t('instagram.comments.errors.generic'))
  }, [comment.id, ignoreComment, actionError, t])

  const handleCallDirect = useCallback(async (text: string) => {
    clearActionError()
    const res = await callDirect(comment.id, { text })
    if (res?.ok) {
      toast.success(t('instagram.comments.toastDirectSent'))
      setShowCallDirectModal(false)
    }
  }, [comment.id, callDirect, clearActionError, t])

  const handleOpenConversation = useCallback(() => {
    if (comment.conversation_id) {
      if (onOpenConversation) {
        onOpenConversation(comment.conversation_id)
      } else {
        // fallback: navegar para chat com query params
        navigate(`/chat?channel=instagram&conversation_id=${comment.conversation_id}`)
      }
    }
  }, [comment.conversation_id, onOpenConversation, navigate])

  const canReply  = comment.status !== 'hidden' && comment.status !== 'ignored'
  const canHide   = comment.status !== 'hidden' && comment.status !== 'ignored'
  const canIgnore = comment.status === 'pending'

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-100">
        <div className="flex items-start gap-3">
          {comment.ig_user_avatar ? (
            <img
              src={comment.ig_user_avatar}
              alt={comment.ig_username ?? 'avatar'}
              className="flex-shrink-0 w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 flex items-center justify-center text-white text-sm font-bold">
              {(comment.ig_username ?? '?').slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800">
              @{comment.ig_username ?? t('instagram.participantUnknown')}
            </p>
            <p className="text-xs text-slate-500">
              {new Date(comment.timestamp).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        <div className="mt-3">
          <CommentStatusBadge
            status={comment.status}
            privateReplySent={comment.private_reply_sent}
          />
        </div>
      </div>

      {/* Conteúdo do comentário */}
      <div className="px-6 py-4 border-b border-slate-100">
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {comment.content}
        </p>

        {comment.ig_media_id && (
          <p className="text-xs text-slate-400 mt-2">
            {t('instagram.comments.mediaId')}: {comment.ig_media_id}
          </p>
        )}
      </div>

      {/* Banner: Direct enviado */}
      {comment.private_reply_sent && comment.conversation_id && (
        <div className="mx-6 mt-4 p-3 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-blue-700">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">{t('instagram.comments.directSent')}</span>
          </div>
          <button
            onClick={handleOpenConversation}
            className="text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-1 flex-shrink-0"
          >
            {t('instagram.comments.actions.openConversation')}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Resposta pública prévia */}
      {comment.reply_content && (
        <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <p className="text-xs font-medium text-emerald-700 mb-1">
            {t('instagram.comments.repliedWith')}
          </p>
          <p className="text-sm text-emerald-800">{comment.reply_content}</p>
        </div>
      )}

      {/* Ações */}
      <div className="px-6 py-4 flex-1">
        <div className="space-y-2">
          {/* PRIMARY: Responder */}
          {canReply && !showReply && (
            <button
              onClick={() => setShowReply(true)}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 text-sm font-medium bg-pink-600 text-white py-2.5 rounded-xl hover:bg-pink-700 disabled:opacity-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              {t('instagram.comments.actions.reply')}
            </button>
          )}

          {/* SECONDARY: Chamar no Direct */}
          <button
            onClick={() => { clearActionError(); setShowCallDirectModal(true) }}
            disabled={actionLoading}
            className="w-full flex items-center justify-center gap-2 text-sm font-medium border border-blue-300 text-blue-600 py-2.5 rounded-xl hover:bg-blue-50 disabled:opacity-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.955 8.955 0 01-2.697-.413l-2.725.725c-.25.067-.516-.073-.573-.323a.994.994 0 01-.006-.315l.725-2.725A8.955 8.955 0 013 12c0-4.418 3.582-8 8-8s8 3.582 8 8z" />
            </svg>
            {t('instagram.comments.actions.callDirect')}
          </button>

          {/* SUCCESS: Converter em Lead */}
          {comment.status !== 'converted_to_lead' && (
            <button
              onClick={() => { clearCreateLeadError(); setShowConvertModal(true) }}
              disabled={actionLoading || createLeadLoading}
              className="w-full flex items-center justify-center gap-2 text-sm font-medium border border-purple-300 text-purple-600 py-2.5 rounded-xl hover:bg-purple-50 disabled:opacity-50 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              {t('instagram.comments.actions.convertLead')}
            </button>
          )}

          {/* Lead vinculado */}
          {comment.lead_id && (
            <button
              onClick={() => navigate(`/leads?lead_id=${comment.lead_id}`)}
              className="w-full flex items-center justify-center gap-2 text-sm font-medium border border-purple-200 text-purple-700 py-2.5 rounded-xl hover:bg-purple-50 transition-colors"
            >
              {t('instagram.viewLead')}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}

          {/* DANGER: Ocultar */}
          {canHide && (
            !confirmHide ? (
              <button
                onClick={() => setConfirmHide(true)}
                disabled={actionLoading}
                className="w-full flex items-center justify-center gap-2 text-sm font-medium border border-red-200 text-red-500 py-2.5 rounded-xl hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
                {t('instagram.comments.actions.hide')}
              </button>
            ) : (
              <div className="border border-red-200 rounded-xl p-3">
                <p className="text-xs text-red-600 mb-2 text-center">{t('instagram.comments.confirmHide')}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmHide(false)}
                    className="flex-1 text-xs text-slate-600 border border-slate-200 rounded-lg py-1.5 hover:bg-slate-50"
                  >
                    {t('instagram.comments.cancel')}
                  </button>
                  <button
                    onClick={handleHide}
                    disabled={actionLoading}
                    className="flex-1 text-xs text-white bg-red-500 rounded-lg py-1.5 hover:bg-red-600 disabled:opacity-60"
                  >
                    {actionLoading
                      ? <span className="inline-block h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : t('instagram.comments.actions.hide')}
                  </button>
                </div>
              </div>
            )
          )}

          {/* NEUTRAL: Ignorar */}
          {canIgnore && (
            <button
              onClick={handleIgnore}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 text-sm text-slate-400 py-2 rounded-xl hover:text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {t('instagram.comments.actions.ignore')}
            </button>
          )}
        </div>
      </div>

      {/* ReplyComposer inline */}
      {showReply && (
        <ReplyComposer
          onSubmit={handleReply}
          loading={actionLoading}
          onCancel={() => setShowReply(false)}
        />
      )}

      {/* Modais */}
      {showCallDirectModal && (
        <CallDirectModal
          igUsername={comment.ig_username}
          loading={actionLoading}
          error={actionError}
          onSubmit={handleCallDirect}
          onClose={() => { setShowCallDirectModal(false); clearActionError() }}
        />
      )}

      {showConvertModal && (
        <ConvertLeadModal
          igUsername={comment.ig_username}
          loading={createLeadLoading}
          error={createLeadError}
          onSubmit={(payload) => createLead(comment.id, payload)}
          onClose={() => { setShowConvertModal(false); clearCreateLeadError() }}
        />
      )}
    </div>
  )
}

export default InstagramCommentDetail
