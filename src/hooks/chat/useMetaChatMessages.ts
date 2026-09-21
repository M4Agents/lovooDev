// =============================================================================
// useMetaChatMessages
//
// Hook isolado para leitura de mensagens de uma conversa Meta WhatsApp.
//
// Responsabilidade (MVP3C.4):
//   - Receber companyId + conversationId
//   - Buscar mensagens via metaWhatsAppApi.getMessages()
//   - Manter estado: messages, loading, error
//   - Refresh explícito
//   - Limpar estado corretamente quando IDs mudarem
//
// Fora do escopo desta fase:
//   - Paginação histórica ("carregar anteriores")
//   - Realtime (MVP3E)
//   - Envio de mensagens (MVP3D)
//   - Cursor-based pagination
//
// Proteções:
//   - Anti-stale: fetchCountRef monotônico descarta respostas de fetches anteriores
//   - Anti-unmount: mountedRef evita setState após desmontagem
//   - Invalidação sem fetch: incrementa fetchCountRef ao zerar IDs, garantindo
//     que resposta pendente não reapareça mesmo que resolva depois do null
//   - Troca A→B: limpa messages imediatamente, só aplica resultado do fetch mais recente
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { metaWhatsAppApi }       from '../../services/metaWhatsAppApi'
import type { MetaChatMessage }  from '../../types/meta-whatsapp'

// ── Contrato público do hook ──────────────────────────────────────────────────

export interface UseMetaChatMessagesResult {
  messages: MetaChatMessage[]
  loading:  boolean
  error:    string | null
  refresh:  () => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMetaChatMessages(
  companyId:      string | undefined,
  conversationId: string | null | undefined
): UseMetaChatMessagesResult {
  const [messages, setMessages] = useState<MetaChatMessage[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // Contador monotônico de fetches.
  // Callbacks assíncronos só aplicam resultado se o número ainda bater —
  // descarta respostas de fetches stale (conversa antiga, refresh substituído).
  // Também é incrementado quando os IDs se tornam inválidos, invalidando
  // qualquer fetch em andamento sem precisar de AbortController.
  const fetchCountRef = useRef(0)

  // Guard de unmount: evita setState após desmontagem do componente.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ── Fetch principal ────────────────────────────────────────────────────────

  const load = useCallback(() => {
    // Sem company ou conversa → invalidar fetch anterior + estado limpo + zero request.
    // O incremento de fetchCountRef garante que qualquer request em andamento
    // seja descartado quando sua resposta chegar.
    if (!companyId || !conversationId) {
      fetchCountRef.current++   // invalida fetch anterior em andamento
      setMessages([])
      setError(null)
      setLoading(false)
      return
    }

    // Limpar dados da conversa anterior imediatamente — sem flash de dados stale.
    setMessages([])
    setError(null)
    setLoading(true)

    const currentFetch = ++fetchCountRef.current

    metaWhatsAppApi
      .getMessages(companyId, conversationId)
      .then((result) => {
        if (!mountedRef.current)                    return  // desmontado
        if (currentFetch !== fetchCountRef.current) return  // stale — ignorar
        setMessages(result)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current)                    return
        if (currentFetch !== fetchCountRef.current) return
        const message =
          err instanceof Error
            ? err.message
            : 'Erro ao carregar mensagens'
        setError(message)
        setMessages([])
      })
      .finally(() => {
        if (!mountedRef.current)                    return
        if (currentFetch !== fetchCountRef.current) return
        setLoading(false)
      })
  }, [companyId, conversationId])

  // ── Disparar busca ao montar e ao mudar company/conversationId ─────────────

  useEffect(() => {
    load()
  }, [load])

  // ── Retorno ───────────────────────────────────────────────────────────────

  return {
    messages,
    loading,
    error,
    refresh: load,
  }
}
