import { useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { uploadChatMedia } from '../../../services/chatMediaUpload'

export type ChatManualScope = {
  companyId: string
  conversationId: string
  userId: string
}

export type ChatManualRunResult =
  | { action: 'send'; media_url: string; op: number }
  | { action: 'fail'; error: string; op: number }
  | { action: 'ignore'; op: number | null }

type ChatManualAttempt = {
  op: number
  signal: AbortSignal
  companyId: string
  conversationId: string
  userId: string
}

type CaptionMessage = {
  content: string
  message_type: 'image' | 'video' | 'document'
  media_url: string
}

type AudioMessage = {
  content: '[áudio]'
  message_type: 'audio'
  media_url: string
}

export function buildCaptionMessage(input: {
  mimeType: string
  fileName: string
  caption: string
  mediaUrl: string
}): CaptionMessage {
  const mimeType = input.mimeType || ''
  const isImage = mimeType.startsWith('image/')
  const isVideo = mimeType.startsWith('video/')
  return {
    content: input.caption.trim() || input.fileName,
    message_type: isVideo ? 'video' : (isImage ? 'image' : 'document'),
    media_url: input.mediaUrl,
  }
}

export function buildAudioPreviewFile(blob: Blob, mimeType: string | null, now = Date.now()): File {
  const extension = mimeType?.includes('webm') ? 'webm' : mimeType?.includes('ogg') ? 'ogg' : 'webm'
  return new File(
    [blob],
    `gravacao-${now}.${extension}`,
    { type: mimeType || blob.type || 'audio/webm' }
  )
}

export function buildAudioMessage(mediaUrl: string): AudioMessage {
  return {
    content: '[áudio]',
    message_type: 'audio',
    media_url: mediaUrl,
  }
}

export function applyChatManualSend(
  outcome: ChatManualRunResult,
  effects: {
    owns: (op: number) => boolean
    send: (mediaUrl: string) => void
    fail: (error: string) => void
    release: (op: number) => void
  }
) {
  if (outcome.action === 'ignore') {
    if (outcome.op !== null && effects.owns(outcome.op)) effects.release(outcome.op)
    return
  }
  if (!effects.owns(outcome.op)) return
  if (outcome.action === 'fail') {
    effects.fail(outcome.error)
    effects.release(outcome.op)
    return
  }
  effects.send(outcome.media_url)
  effects.release(outcome.op)
}

async function readSessionUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.user?.id ?? null
}

/**
 * Uma tentativa de upload manual por vez.
 * Troca de empresa, conversa, usuário ou desmontagem invalida a tentativa antiga
 * sem alterar loading ou prévia de uma tentativa nova.
 */
export function useChatManualUpload(scope: ChatManualScope, onInvalidate?: () => void) {
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const sessionUserId = useRef<string | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const scopeRef = useRef(scope)
  const onInvalidateRef = useRef(onInvalidate)
  scopeRef.current = scope
  onInvalidateRef.current = onInvalidate

  const invalidate = () => {
    controller.current?.abort()
    generation.current += 1
    inFlight.current = false
    onInvalidateRef.current?.()
  }
  const invalidateRef = useRef(invalidate)
  invalidateRef.current = invalidate

  useEffect(() => {
    mounted.current = true
    let ignore = false
    void supabase.auth.getSession().then(({ data }) => {
      if (ignore || generation.current > 0) return
      sessionUserId.current = data.session?.user?.id ?? null
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id ?? null
      if (sessionUserId.current && next !== sessionUserId.current) invalidateRef.current()
      sessionUserId.current = next
    })
    return () => {
      ignore = true
      mounted.current = false
      generation.current += 1
      inFlight.current = false
      controller.current?.abort()
      data.subscription.unsubscribe()
    }
  }, [])

  const scopeReady = useRef(false)
  useEffect(() => {
    if (!scopeReady.current) {
      scopeReady.current = true
      return
    }
    invalidateRef.current()
  }, [scope.companyId, scope.conversationId, scope.userId])

  const ownsLoading = (op: number) => mounted.current && generation.current === op

  const matches = (attempt: ChatManualAttempt) => ownsLoading(attempt.op)
    && scopeRef.current.companyId === attempt.companyId
    && scopeRef.current.conversationId === attempt.conversationId
    && scopeRef.current.userId === attempt.userId
    && sessionUserId.current === attempt.userId

  const finish = (op: number) => {
    if (generation.current === op) inFlight.current = false
  }

  const run = async (file: File): Promise<ChatManualRunResult> => {
    if (inFlight.current || !mounted.current) return { action: 'ignore', op: null }
    const captured = scopeRef.current
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    const op = ++generation.current
    sessionUserId.current = captured.userId
    inFlight.current = true
    const attempt: ChatManualAttempt = {
      op,
      signal: next.signal,
      companyId: captured.companyId,
      conversationId: captured.conversationId,
      userId: captured.userId,
    }
    try {
      const userAtStart = await readSessionUserId()
      if (!matches(attempt)) return { action: 'ignore', op }
      if (userAtStart !== attempt.userId) {
        return { action: 'fail', error: 'Sessão inválida ou expirada.', op }
      }
      const uploaded = await uploadChatMedia(file, {
        purpose: 'chat_manual',
        companyId: attempt.companyId,
        conversationId: attempt.conversationId,
      }, attempt.signal)
      if (!matches(attempt)) return { action: 'ignore', op }
      if (!uploaded.ok) {
        if (uploaded.cancelled) return { action: 'ignore', op }
        return { action: 'fail', error: uploaded.error, op }
      }
      const userBeforeSend = await readSessionUserId()
      if (!matches(attempt)) return { action: 'ignore', op }
      if (userBeforeSend !== attempt.userId) {
        return { action: 'fail', error: 'A sessão mudou durante o envio.', op }
      }
      return { action: 'send', media_url: uploaded.media_url, op }
    } finally {
      finish(op)
    }
  }

  return { run, ownsLoading }
}
