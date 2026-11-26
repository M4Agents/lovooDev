import { useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { uploadChatMedia } from '../../../services/chatMediaUpload'

export type AutomationAudioScope = {
  companyId: string
  flowId: string
  userId: string
}

export type AutomationAudioRunResult =
  | { action: 'apply'; media_url: string; op: number }
  | { action: 'fail'; error: string; op: number | null }
  | { action: 'ignore'; op: number | null }

type AutomationAudioAttempt = AutomationAudioScope & {
  op: number
  signal: AbortSignal
}

export function applyAutomationAudioResult(
  outcome: AutomationAudioRunResult,
  effects: {
    owns: (op: number) => boolean
    apply: (mediaUrl: string) => void
    fail: (error: string) => void
    release: () => void
  }
) {
  if (outcome.action === 'ignore') {
    if (outcome.op !== null && effects.owns(outcome.op)) effects.release()
    return
  }
  if (outcome.op === null || !effects.owns(outcome.op)) {
    if (outcome.action === 'fail' && outcome.op === null) {
      effects.fail(outcome.error)
      effects.release()
    }
    return
  }
  if (outcome.action === 'fail') {
    effects.fail(outcome.error)
    effects.release()
    return
  }
  effects.apply(outcome.media_url)
  effects.release()
}

async function readSessionUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.user?.id ?? null
}

/**
 * Uma gravação de áudio de automação por vez.
 * Troca de empresa, fluxo, usuário ou desmontagem invalida a tentativa antiga
 * sem atualizar o formulário de outro fluxo.
 */
export function useAutomationAudioUpload(scope: AutomationAudioScope, onInvalidate?: () => void) {
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
  }, [scope.companyId, scope.flowId, scope.userId])

  const ownsLoading = (op: number) => mounted.current && generation.current === op

  const matches = (attempt: AutomationAudioAttempt) => ownsLoading(attempt.op)
    && scopeRef.current.companyId === attempt.companyId
    && scopeRef.current.flowId === attempt.flowId
    && scopeRef.current.userId === attempt.userId
    && sessionUserId.current === attempt.userId

  const run = async (file: File): Promise<AutomationAudioRunResult> => {
    if (inFlight.current || !mounted.current) return { action: 'ignore', op: null }
    const captured = scopeRef.current
    if (!captured.companyId) return { action: 'fail', error: 'Company ID não encontrado', op: null }
    if (!captured.flowId) return { action: 'fail', error: 'Fluxo não identificado.', op: null }
    if (!captured.userId) return { action: 'fail', error: 'Sessão inválida ou expirada.', op: null }
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    const op = ++generation.current
    sessionUserId.current = captured.userId
    inFlight.current = true
    const attempt: AutomationAudioAttempt = { ...captured, op, signal: next.signal }
    try {
      const userAtStart = await readSessionUserId()
      if (!matches(attempt)) return { action: 'ignore', op }
      if (userAtStart !== attempt.userId) {
        return { action: 'fail', error: 'Sessão inválida ou expirada.', op }
      }
      const uploaded = await uploadChatMedia(file, {
        purpose: 'automation_audio',
        companyId: attempt.companyId,
        flowId: attempt.flowId,
      }, attempt.signal)
      if (!matches(attempt)) return { action: 'ignore', op }
      if (!uploaded.ok) {
        if (uploaded.cancelled) return { action: 'ignore', op }
        return { action: 'fail', error: uploaded.error, op }
      }
      const userBeforeApply = await readSessionUserId()
      if (!matches(attempt)) return { action: 'ignore', op }
      if (userBeforeApply !== attempt.userId) {
        return { action: 'fail', error: 'A sessão mudou durante o envio.', op }
      }
      return { action: 'apply', media_url: uploaded.media_url, op }
    } finally {
      if (generation.current === op) inFlight.current = false
    }
  }

  return { run, ownsLoading }
}
