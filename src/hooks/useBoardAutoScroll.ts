// =====================================================
// HOOK: useBoardAutoScroll
// Objetivo: auto scroll horizontal durante drag and drop no board do funil
// Estratégia:
//   - pointermove + mousemove no document (robustez cross-browser)
//   - requestAnimationFrame para loop de scroll suave e não bloqueante
//   - getBoundingClientRect() cacheado no início do drag
//   - velocidade progressiva quadrática conforme proximidade da borda
//   - clamping de scrollLeft para nunca sair do range válido
//   - cleanup completo ao fim do drag
// =====================================================

import { useEffect, useRef, RefObject } from 'react'

const SCROLL_ZONE_WIDTH = 150  // px desde a borda esquerda/direita do container
const MAX_SCROLL_SPEED  = 12   // px por frame a 60fps (~720px/s no máximo)

export function useBoardAutoScroll(
  scrollRef: RefObject<HTMLElement>,
  isDragging: boolean
) {
  const pointerXRef = useRef<number>(0)
  const rafIdRef    = useRef<number | null>(null)
  const rectRef     = useRef<DOMRect | null>(null)

  useEffect(() => {
    if (!isDragging || !scrollRef.current) return

    // Cachear o bounding rect do container uma vez ao iniciar o drag
    rectRef.current = scrollRef.current.getBoundingClientRect()

    // Atualizar o cursor — handler compartilhado para pointermove e mousemove
    const updateX = (e: PointerEvent | MouseEvent) => {
      pointerXRef.current = e.clientX
    }

    // Recalcular o rect apenas se a janela for redimensionada durante o drag
    const onResize = () => {
      if (scrollRef.current) {
        rectRef.current = scrollRef.current.getBoundingClientRect()
      }
    }

    const scroll = () => {
      const container = scrollRef.current
      const rect      = rectRef.current

      if (container && rect) {
        const x         = pointerXRef.current
        const distLeft  = x - rect.left
        const distRight = rect.right - x

        // Só ativa se o cursor estiver dentro dos limites horizontais do container
        const maxScroll = container.scrollWidth - container.clientWidth

        if (distLeft >= 0 && distLeft < SCROLL_ZONE_WIDTH) {
          // Zona esquerda — scroll para a esquerda
          const ratio = 1 - distLeft / SCROLL_ZONE_WIDTH
          const speed = MAX_SCROLL_SPEED * ratio * ratio
          container.scrollLeft = Math.max(0, container.scrollLeft - speed)
        } else if (distRight >= 0 && distRight < SCROLL_ZONE_WIDTH) {
          // Zona direita — scroll para a direita
          const ratio = 1 - distRight / SCROLL_ZONE_WIDTH
          const speed = MAX_SCROLL_SPEED * ratio * ratio
          container.scrollLeft = Math.min(maxScroll, container.scrollLeft + speed)
        }
      }

      rafIdRef.current = requestAnimationFrame(scroll)
    }

    document.addEventListener('pointermove', updateX as EventListener)
    document.addEventListener('mousemove',   updateX as EventListener)
    window.addEventListener('resize', onResize)
    rafIdRef.current = requestAnimationFrame(scroll)

    return () => {
      document.removeEventListener('pointermove', updateX as EventListener)
      document.removeEventListener('mousemove',   updateX as EventListener)
      window.removeEventListener('resize', onResize)
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      rectRef.current = null
    }
  }, [isDragging, scrollRef])
}
