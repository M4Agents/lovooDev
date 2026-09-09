// =====================================================
// CHAT.Q2 — Helper de Timeout para Promises
// Data: 09/09/2026
// =====================================================

/**
 * Adiciona timeout a uma promise
 * @param promise - Promise a ser executada
 * @param timeoutMs - Tempo limite em milissegundos
 * @param timeoutError - Mensagem de erro customizada
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: string = `Operação excedeu o tempo limite de ${timeoutMs}ms`
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutError)), timeoutMs)
    )
  ])
}
