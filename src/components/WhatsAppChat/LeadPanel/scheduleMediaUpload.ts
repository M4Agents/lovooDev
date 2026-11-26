import { useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { uploadChatMedia } from '../../../services/chatMediaUpload'

export type ScheduleUploadScope = {
  companyId: string
  conversationId: string
  instanceId: string
  userId: string
}

export type ScheduleRunResult =
  | { action: 'scheduled'; op: number; media_url: string | null }
  | { action: 'fail'; error: string; op: number | null }
  | { action: 'ignore'; op: number | null }

type ScheduleAttempt = ScheduleUploadScope & {
  op: number
  signal: AbortSignal
}

type ScheduleProgress = (loaded: number, total: number) => void

export function scheduleProgressPercent(loaded: number, total: number): number | null {
  if (!Number.isFinite(loaded) || !Number.isFinite(total) || total <= 0) return null
  return Math.min(100, Math.round((loaded / total) * 100))
}

export function applyScheduleResult(
  outcome: ScheduleRunResult,
  effects: {
    owns: (op: number) => boolean
    complete: () => void
    fail: () => void
    release: () => void
  }
) {
  if (outcome.action === 'ignore') {
    if (outcome.op !== null && effects.owns(outcome.op)) effects.release()
    return
  }
  if (outcome.op === null || !effects.owns(outcome.op)) return
  if (outcome.action === 'fail') {
    effects.fail()
    effects.release()
    return
  }
  effects.complete()
  effects.release()
}

async function readSessionUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.user?.id ?? null
}

/**
 * Uma tentativa de agendamento por vez.
 * Troca de empresa, conversa, instância, usuário, fechamento do formulário
 * ou desmontagem invalida a tentativa antiga sem alterar o formulário novo.
 */
export function useChatScheduleUpload(
  scope: ScheduleUploadScope,
  options?: { active?: boolean; onInvalidate?: () => void }
) {
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const sessionUserId = useRef<string | null>(null)
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const scopeRef = useRef(scope)
  const onInvalidateRef = useRef(options?.onInvalidate)
  const activeRef = useRef(options?.active ?? true)
  scopeRef.current = scope
  onInvalidateRef.current = options?.onInvalidate
  activeRef.current = options?.active ?? true

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
  }, [scope.companyId, scope.conversationId, scope.instanceId, scope.userId])

  const activeReady = useRef(false)
  useEffect(() => {
    if (!activeReady.current) {
      activeReady.current = true
      return
    }
    if (!activeRef.current) invalidateRef.current()
  }, [options?.active])

  const ownsLoading = (op: number) => mounted.current && generation.current === op

  const matches = (attempt: ScheduleAttempt) => ownsLoading(attempt.op)
    && scopeRef.current.companyId === attempt.companyId
    && scopeRef.current.conversationId === attempt.conversationId
    && scopeRef.current.instanceId === attempt.instanceId
    && scopeRef.current.userId === attempt.userId
    && sessionUserId.current === attempt.userId

  const run = async (input: {
    file: File | null
    onProgress?: ScheduleProgress
    persist: (mediaUrl: string | null, attempt: ScheduleUploadScope) => Promise<void>
  }): Promise<ScheduleRunResult> => {
    if (inFlight.current || !mounted.current) return { action: 'ignore', op: null }
    const captured = scopeRef.current
    if (!captured.companyId || !captured.conversationId || !captured.instanceId || !captured.userId) {
      return { action: 'fail', error: 'Identificador inválido.', op: null }
    }
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    const op = ++generation.current
    sessionUserId.current = captured.userId
    inFlight.current = true
    const attempt: ScheduleAttempt = { ...captured, op, signal: next.signal }
    try {
      const userAtStart = await readSessionUserId()
      if (!matches(attempt)) return { action: 'ignore', op }
      if (userAtStart !== attempt.userId) {
        return { action: 'fail', error: 'Sessão inválida ou expirada.', op }
      }
      let mediaUrl: string | null = null
      if (input.file) {
        const uploaded = await uploadChatMedia(input.file, {
          purpose: 'chat_schedule',
          companyId: attempt.companyId,
          conversationId: attempt.conversationId,
          instanceId: attempt.instanceId,
          onProgress: (loaded, total) => {
            if (matches(attempt)) input.onProgress?.(loaded, total)
          },
        }, attempt.signal)
        if (!matches(attempt)) return { action: 'ignore', op }
        if (!uploaded.ok) {
          if (uploaded.cancelled) return { action: 'ignore', op }
          return { action: 'fail', error: uploaded.error, op }
        }
        mediaUrl = uploaded.media_url
      }
      const userBeforePersist = await readSessionUserId()
      if (!matches(attempt)) return { action: 'ignore', op }
      if (userBeforePersist !== attempt.userId) {
        return { action: 'fail', error: 'A sessão mudou durante o envio.', op }
      }
      try {
        await input.persist(mediaUrl, {
          companyId: attempt.companyId,
          conversationId: attempt.conversationId,
          instanceId: attempt.instanceId,
          userId: attempt.userId,
        })
      } catch {
        if (!matches(attempt)) return { action: 'ignore', op }
        return { action: 'fail', error: 'Falha ao agendar.', op }
      }
      if (!matches(attempt)) return { action: 'ignore', op }
      return { action: 'scheduled', op, media_url: mediaUrl }
    } finally {
      if (generation.current === op) inFlight.current = false
    }
  }

  return { run, ownsLoading }
}
