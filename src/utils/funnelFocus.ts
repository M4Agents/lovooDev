import { useEffect, useState } from 'react'

export const FUNNEL_OPP_FOCUS_ATTR = 'data-funnel-opportunity-id'

export type FunnelOpenTarget = {
  opportunityId: string
  stageId: string
}

export type FunnelLeadClickHandler = (
  leadId: number,
  target?: FunnelOpenTarget,
) => void

export type FunnelRestoreFocus = {
  opportunityId: string
  nonce: number
}

function findOpportunityElement(opportunityId: string): HTMLElement | null {
  const escaped = typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(opportunityId)
    : opportunityId.replace(/"/g, '')
  const el = document.querySelector(`[${FUNNEL_OPP_FOCUS_ATTR}="${escaped}"]`)
  return el instanceof HTMLElement ? el : null
}

/** Rola até o card/linha. Tenta de novo se o refresh ainda estiver pintando a lista. */
export function scheduleScrollToFunnelOpportunity(
  opportunityId: string,
  onFound?: (el: HTMLElement) => void,
  attempts = 10,
  intervalMs = 80,
): () => void {
  let cancelled = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = () => {
    if (cancelled) return
    const el = findOpportunityElement(opportunityId)
    if (el) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
      onFound?.(el)
      return
    }
    attempt += 1
    if (attempt < attempts) {
      timer = setTimeout(tick, intervalMs)
    }
  }

  timer = setTimeout(tick, 0)
  return () => {
    cancelled = true
    if (timer) clearTimeout(timer)
  }
}

export function useRestoreFunnelFocus(restoreFocus?: FunnelRestoreFocus | null): string | null {
  const [highlightId, setHighlightId] = useState<string | null>(null)

  useEffect(() => {
    if (!restoreFocus?.opportunityId) return
    const stop = scheduleScrollToFunnelOpportunity(restoreFocus.opportunityId, () => {
      setHighlightId(restoreFocus.opportunityId)
    })
    const clear = window.setTimeout(() => setHighlightId(null), 1600)
    return () => {
      stop()
      clearTimeout(clear)
    }
  }, [restoreFocus])

  return highlightId
}
