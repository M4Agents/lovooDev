// =============================================================================
// useMetaChatData
//
// Hook isolado para leitura de conversas Meta WhatsApp no Chat.
//
// Responsabilidade nesta fase (MVP3C.2):
//   - Receber companyId + selectedInstanceId (Meta)
//   - Buscar conversas via metaWhatsAppApi.getConversations()
//   - Manter estado: conversations, loading, error, selectedConversationId
//   - Permitir seleção de conversa (estado local)
//   - Refresh explícito
//   - Limpar estado corretamente quando company/instance mudar
//
// Fora do escopo desta fase:
//   - Busca de messages (responsabilidade do MetaChatArea — fase seguinte)
//   - Realtime (não implementado neste MVP)
//   - Supabase direto, EventBus Uazapi, polling, envio
//   - unread mutation, optimistic updates
//
// Proteções:
//   - Anti-stale: fetchCountRef descarta respostas de fetches anteriores
//   - Anti-unmount: mountedRef evita setState após desmontagem
//   - Troca de instance: limpa selectedConversationId e conversations imediatamente
//   - companyId ou selectedInstanceId ausentes: zero request, estado limpo
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { metaWhatsAppApi }                          from '../../services/metaWhatsAppApi'
import type { MetaChatConversation }                from '../../types/meta-whatsapp'

// ── Contrato público do hook ──────────────────────────────────────────────────

export interface UseMetaChatDataResult {
  conversations:           MetaChatConversation[]
  loading:                 boolean
  error:                   string | null
  selectedConversationId:  string | null
  setSelectedConversation: (id: string | null) => void
  refresh:                 () => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMetaChatData(
  companyId:          string | undefined,
  selectedInstanceId: string | undefined
): UseMetaChatDataResult {
  const [conversations,          setConversations]          = useState<MetaChatConversation[]>([])
  const [loading,                setLoading]                = useState(false)
  const [error,                  setError]                  = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  // Contador monotônico de fetches.
  // Callbacks assíncronos só aplicam resultado se o número ainda bater —
  // descarta respostas de fetches stale (instância antiga, refresh substituído).
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
    // Sem company ou instância → estado limpo, zero request.
    if (!companyId || !selectedInstanceId) {
      setConversations([])
      setLoading(false)
      setError(null)
      return
    }

    // Limpar dados da instância anterior imediatamente para evitar flash de dados stale.
    setConversations([])
    setError(null)
    setLoading(true)

    const currentFetch = ++fetchCountRef.current

    metaWhatsAppApi
      .getConversations(companyId, { instanceId: selectedInstanceId })
      .then((result) => {
        if (!mountedRef.current)                        return  // desmontado
        if (currentFetch !== fetchCountRef.current)     return  // stale — ignorar
        setConversations(result)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current)                        return
        if (currentFetch !== fetchCountRef.current)     return
        const message =
          err instanceof Error
            ? err.message
            : 'Erro ao carregar conversas Meta WhatsApp'
        setError(message)
      })
      .finally(() => {
        if (!mountedRef.current)                        return
        if (currentFetch !== fetchCountRef.current)     return
        setLoading(false)
      })
  }, [companyId, selectedInstanceId])

  // ── Troca de instância → limpar conversa selecionada ──────────────────────
  // Executado antes do load() para garantir que nunca reutilizamos um
  // conversationId de uma instância anterior.

  useEffect(() => {
    setSelectedConversationId(null)
  }, [selectedInstanceId, companyId])

  // ── Disparar busca ao montar e ao mudar company/instância ─────────────────

  useEffect(() => {
    load()
  }, [load])

  // ── Handler de seleção de conversa (estado local apenas) ──────────────────

  const handleSetSelectedConversation = useCallback((id: string | null) => {
    setSelectedConversationId(id)
  }, [])

  // ── Retorno ───────────────────────────────────────────────────────────────

  return {
    conversations,
    loading,
    error,
    selectedConversationId,
    setSelectedConversation: handleSetSelectedConversation,
    refresh: load,
  }
}
