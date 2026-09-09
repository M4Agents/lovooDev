// =====================================================
// CHAT.Q2 — Helper de Debounce
// Data: 09/09/2026
// =====================================================

/**
 * Cria uma versão debounced de uma função async
 * @param func - Função async a ser executada
 * @param delay - Atraso em milissegundos
 */
export function debounce<T extends (...args: any[]) => Promise<any>>(
  func: T,
  delay: number
): (...args: Parameters<T>) => Promise<ReturnType<T>> {
  let timeoutId: NodeJS.Timeout | null = null
  let latestResolve: ((value: any) => void) | null = null
  let latestReject: ((reason?: any) => void) | null = null

  return function (this: any, ...args: Parameters<T>): Promise<ReturnType<T>> {
    // Cancelar timeout anterior
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    // Criar nova promise que será resolvida após o delay
    const promise = new Promise<ReturnType<T>>((resolve, reject) => {
      latestResolve = resolve
      latestReject = reject

      timeoutId = setTimeout(async () => {
        try {
          const result = await func.apply(this, args)
          resolve(result)
        } catch (error) {
          reject(error)
        }
      }, delay)
    })

    return promise
  }
}
