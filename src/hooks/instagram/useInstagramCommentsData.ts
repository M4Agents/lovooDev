// =====================================================
// HOOK: useInstagramCommentsData
// =====================================================
// Gerencia estado de comentários Instagram.
// COMPLETAMENTE ISOLADO de useInstagramChatData (DMs).
// Nunca usa instagram_messages, InstagramChatArea ou types de DM.
//
// Ativado apenas quando tab = 'comments' ou 'pending' (lazy).
// =====================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import type {
  InstagramComment,
  InstagramCommentsFilter,
  CommentReplyPayload,
  CallDirectPayload,
  CallDirectResponse,
  CreateCommentLeadPayload,
  CreateCommentLeadResponse,
} from '../../types/instagram-comments'

// =====================================================
// TIPOS RETORNADOS
// =====================================================

export interface UseInstagramCommentsDataReturn {
  comments: InstagramComment[]
  commentsLoading: boolean
  commentsError: string | undefined
  selectedCommentId: string | undefined
  setSelectedComment: (id: string | undefined) => void
  selectedComment: InstagramComment | undefined

  filter: InstagramCommentsFilter
  setFilter: (f: InstagramCommentsFilter) => void

  actionLoading: boolean
  actionError: string | undefined
  clearActionError: () => void

  replyComment: (commentId: string, payload: CommentReplyPayload) => Promise<boolean>
  hideComment: (commentId: string) => Promise<boolean>
  ignoreComment: (commentId: string) => Promise<boolean>
  callDirect: (commentId: string, payload: CallDirectPayload) => Promise<CallDirectResponse | null>
  createLead: (commentId: string, payload: CreateCommentLeadPayload) => Promise<CreateCommentLeadResponse | null>

  createLeadLoading: boolean
  createLeadError: string | undefined
  clearCreateLeadError: () => void

  refreshComments: () => void
}

// =====================================================
// HELPERS DE FETCH
// =====================================================

async function fetchWithAuth<T>(url: string): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = Object.assign(new Error(data.message ?? data.error ?? `HTTP ${res.status}`), {
      errorCode: data.error,
    })
    throw err
  }
  return data
}

async function postWithAuth<T>(url: string, body: unknown, method = 'POST'): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token ?? ''

  const res = await fetch(url, {
    method,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = Object.assign(new Error(data.message ?? data.error ?? `HTTP ${res.status}`), {
      errorCode: data.error,
    })
    throw err
  }
  return data
}

// =====================================================
// HOOK PRINCIPAL
// =====================================================

export function useInstagramCommentsData(
  companyId: string,
  connectionId: string,
  filter: InstagramCommentsFilter,
  enabled: boolean,
): UseInstagramCommentsDataReturn {
  const [comments,        setComments]        = useState<InstagramComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsError,   setCommentsError]   = useState<string | undefined>()

  const [selectedCommentId, setSelectedCommentId] = useState<string | undefined>()

  const [actionLoading,    setActionLoading]    = useState(false)
  const [actionError,      setActionError]      = useState<string | undefined>()
  const [createLeadLoading, setCreateLeadLoading] = useState(false)
  const [createLeadError,   setCreateLeadError]   = useState<string | undefined>()

  // Ref para acessar comments dentro de realtime sem criar dep circular
  const commentsRef = useRef(comments)
  useEffect(() => { commentsRef.current = comments }, [comments])

  const [internalFilter, setInternalFilter] = useState<InstagramCommentsFilter>(filter)

  // Sincronizar filter externo → interno
  useEffect(() => { setInternalFilter(filter) }, [filter.tab, filter.connection_id, filter.search])

  // =====================================================
  // FETCH
  // =====================================================

  const fetchComments = useCallback(async () => {
    if (!enabled || !companyId) return
    try {
      setCommentsLoading(true)
      setCommentsError(undefined)

      const params = new URLSearchParams({
        company_id: companyId,
        tab:        internalFilter.tab,
      })
      if (internalFilter.connection_id) params.set('connection_id', internalFilter.connection_id)
      if (internalFilter.search?.trim()) params.set('search', internalFilter.search.trim())

      const data = await fetchWithAuth<{ comments: InstagramComment[] }>(
        `/api/instagram/comments?${params}`
      )
      setComments(data.comments ?? [])
    } catch (err: any) {
      setCommentsError(err.message ?? 'Erro ao carregar comentários')
      setComments([])
    } finally {
      setCommentsLoading(false)
    }
  }, [enabled, companyId, internalFilter.tab, internalFilter.connection_id, internalFilter.search])

  useEffect(() => {
    if (enabled) fetchComments()
    else {
      setComments([])
      setSelectedCommentId(undefined)
    }
  }, [fetchComments, enabled])

  // =====================================================
  // REALTIME — instagram_comments
  // =====================================================
  // Subscribed apenas quando enabled = true (tab de comentários ativa).
  // INSERT: novo comentário no topo.
  // UPDATE: atualiza badge de status + private_reply_sent.

  useEffect(() => {
    if (!enabled || !companyId) return

    const channel = supabase
      .channel(`ig_comments_${companyId}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table:  'instagram_comments',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newComment = payload.new as InstagramComment
            // Respeitar filtro de tab
            const tabOk =
              internalFilter.tab === 'comments'
                ? newComment.status !== 'ignored'
                : newComment.status === 'pending'
            if (!tabOk) return
            setComments(prev => {
              if (prev.some(c => c.id === newComment.id)) return prev
              return [newComment, ...prev]
            })
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as InstagramComment
            setComments(prev => {
              // Se o novo status faz o comentário sair do filtro atual, remover da lista
              const shouldShow =
                internalFilter.tab === 'comments'
                  ? updated.status !== 'ignored'
                  : updated.status === 'pending'

              if (!shouldShow) {
                return prev.filter(c => c.id !== updated.id)
              }
              return prev.map(c => c.id === updated.id ? { ...c, ...updated } : c)
            })
          }
        }
      )
      .subscribe()

    return () => { channel.unsubscribe() }
  }, [enabled, companyId, internalFilter.tab])

  // =====================================================
  // COMPUTED
  // =====================================================

  const selectedComment = useMemo(
    () => comments.find(c => c.id === selectedCommentId),
    [comments, selectedCommentId]
  )

  // =====================================================
  // AÇÕES
  // =====================================================

  const replyComment = useCallback(async (commentId: string, payload: CommentReplyPayload): Promise<boolean> => {
    setActionLoading(true)
    setActionError(undefined)
    try {
      await postWithAuth(`/api/instagram/comments/${commentId}/reply`, payload)
      setComments(prev => prev.map(c =>
        c.id === commentId
          ? { ...c, status: 'replied', replied_at: new Date().toISOString(), reply_content: payload.text }
          : c
      ))
      return true
    } catch (err: any) {
      setActionError(err.message ?? 'Erro ao responder comentário')
      return false
    } finally {
      setActionLoading(false)
    }
  }, [])

  const hideComment = useCallback(async (commentId: string): Promise<boolean> => {
    setActionLoading(true)
    setActionError(undefined)
    try {
      await postWithAuth(`/api/instagram/comments/${commentId}/hide`, {})
      setComments(prev => prev.map(c =>
        c.id === commentId ? { ...c, status: 'hidden' } : c
      ))
      return true
    } catch (err: any) {
      setActionError(err.message ?? 'Erro ao ocultar comentário')
      return false
    } finally {
      setActionLoading(false)
    }
  }, [])

  const ignoreComment = useCallback(async (commentId: string): Promise<boolean> => {
    setActionLoading(true)
    setActionError(undefined)
    try {
      await postWithAuth(`/api/instagram/comments/${commentId}/ignore`, {}, 'PATCH')
      // Remover da lista (ignorados saem do filtro)
      setComments(prev => prev.filter(c => c.id !== commentId))
      if (selectedCommentId === commentId) setSelectedCommentId(undefined)
      return true
    } catch (err: any) {
      setActionError(err.message ?? 'Erro ao ignorar comentário')
      return false
    } finally {
      setActionLoading(false)
    }
  }, [selectedCommentId])

  const callDirect = useCallback(async (commentId: string, payload: CallDirectPayload): Promise<CallDirectResponse | null> => {
    setActionLoading(true)
    setActionError(undefined)
    try {
      const res = await postWithAuth<CallDirectResponse>(
        `/api/instagram/comments/${commentId}/call-direct`,
        payload
      )
      // Atualizar localmente: private_reply_sent + conversation_id
      setComments(prev => prev.map(c =>
        c.id === commentId
          ? { ...c, private_reply_sent: true, conversation_id: res.conversation_id ?? c.conversation_id }
          : c
      ))
      return res
    } catch (err: any) {
      setActionError(err.message ?? 'Erro ao enviar Direct')
      return null
    } finally {
      setActionLoading(false)
    }
  }, [])

  const createLead = useCallback(async (commentId: string, payload: CreateCommentLeadPayload): Promise<CreateCommentLeadResponse | null> => {
    setCreateLeadLoading(true)
    setCreateLeadError(undefined)
    try {
      const res = await postWithAuth<CreateCommentLeadResponse>(
        `/api/instagram/comments/${commentId}/create-lead`,
        payload
      )
      if (res.lead_id) {
        setComments(prev => prev.map(c =>
          c.id === commentId
            ? { ...c, lead_id: res.lead_id, status: 'converted_to_lead' }
            : c
        ))
      }
      return res
    } catch (err: any) {
      const msg = err.errorCode === 'plan_limit_exceeded'
        ? 'plan_limit_exceeded'
        : (err.message ?? 'Erro ao criar lead')
      setCreateLeadError(msg)
      return null
    } finally {
      setCreateLeadLoading(false)
    }
  }, [])

  const setFilter = useCallback((f: InstagramCommentsFilter) => {
    setInternalFilter(f)
    setSelectedCommentId(undefined)
  }, [])

  const setSelectedComment = useCallback((id: string | undefined) => {
    setSelectedCommentId(id)
  }, [])

  const refreshComments = useCallback(() => { fetchComments() }, [fetchComments])

  const clearActionError     = useCallback(() => setActionError(undefined), [])
  const clearCreateLeadError = useCallback(() => setCreateLeadError(undefined), [])

  // =====================================================
  // RETORNO
  // =====================================================

  return {
    comments,
    commentsLoading,
    commentsError,
    selectedCommentId,
    setSelectedComment,
    selectedComment,
    filter: internalFilter,
    setFilter,
    actionLoading,
    actionError,
    clearActionError,
    replyComment,
    hideComment,
    ignoreComment,
    callDirect,
    createLead,
    createLeadLoading,
    createLeadError,
    clearCreateLeadError,
    refreshComments,
  }
}
