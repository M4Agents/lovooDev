import { useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

type Scope = {
  companyId: string
  sourceId?: string
}

export type CatalogUploadAttempt = {
  op: number
  signal: AbortSignal
  companyId: string
  sourceId?: string
  userId: string | null
}

/**
 * Uma tentativa de upload por vez. Troca de empresa, item, usuário ou desmontagem
 * invalida a tentativa antiga sem apagar o resultado de uma tentativa nova.
 */
export function useCatalogUploadGuard(scope: Scope, onInvalidate?: () => void) {
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const userId = useRef<string | null>(null)
  const mounted = useRef(true)
  const scopeRef = useRef(scope)
  const onInvalidateRef = useRef(onInvalidate)
  scopeRef.current = scope
  onInvalidateRef.current = onInvalidate

  const invalidate = () => {
    controller.current?.abort()
    generation.current += 1
    onInvalidateRef.current?.()
  }
  const invalidateRef = useRef(invalidate)
  invalidateRef.current = invalidate

  useEffect(() => {
    mounted.current = true
    let ignore = false
    void supabase.auth.getSession().then(({ data }) => {
      if (ignore || generation.current > 0) return
      userId.current = data.session?.user?.id ?? null
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const next = session?.user?.id ?? null
      if (userId.current && next !== userId.current) invalidateRef.current()
      userId.current = next
    })
    return () => {
      ignore = true
      mounted.current = false
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
  }, [scope.companyId, scope.sourceId])

  const begin = (currentUserId: string | null): CatalogUploadAttempt => {
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    const op = ++generation.current
    userId.current = currentUserId
    return {
      op,
      signal: next.signal,
      companyId: scopeRef.current.companyId,
      sourceId: scopeRef.current.sourceId,
      userId: currentUserId,
    }
  }

  const matches = (attempt: CatalogUploadAttempt) => mounted.current
    && generation.current === attempt.op
    && scopeRef.current.companyId === attempt.companyId
    && scopeRef.current.sourceId === attempt.sourceId
    && userId.current === attempt.userId

  const ownsLoading = (op: number) => mounted.current && generation.current === op

  return { begin, matches, ownsLoading }
}
