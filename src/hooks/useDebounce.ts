import { useState, useEffect } from 'react'

/**
 * Retorna o valor debounced — só atualiza após `delay` ms sem mudança.
 * Usado para evitar re-renders ou requests a cada tecla em campos de busca.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
