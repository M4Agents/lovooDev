// Controla qual resposta de grupos de tags ainda pode atualizar a tela.
// Uma resposta antiga perde, mesmo que o cancelamento da rede não a impeça de chegar.

export function createRequestGate() {
  let current = 0

  return {
    next(): number {
      current += 1
      return current
    },
    isCurrent(requestId: number): boolean {
      return requestId === current
    },
  }
}
