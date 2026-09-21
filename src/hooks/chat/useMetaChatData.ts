// =============================================================================
// useMetaChatData
//
// Hook isolado para leitura de conversas Meta WhatsApp no Chat.
//
// Responsabilidade (MVP3C.2 + MVP3E B2):
//   - Receber companyId + selectedInstanceId (Meta)
//   - Buscar conversas via metaWhatsAppApi.getConversations()
//   - Manter estado: conversations, loading, error, selectedConversationId
//   - Permitir seleção de conversa (estado local)
//   - Refresh explícito
//   - Limpar estado corretamente quando company/instance mudar
//   - Realtime: subscription UPDATE em meta_conversations → sinal de invalidação
//     (MVP3E B2 — quando inbound atualiza conversa, sidebar reflete automaticamente)
//
// Fora do escopo:
//   - Busca de messages (useMetaChatMessages — B1)
//   - unread mutation, optimistic updates
//   - Outbound sidebar update (send.js não atualiza meta_conversations — débito)
//
// Proteções:
//   - Anti-stale: fetchCountRef descarta respostas de fetches anteriores
//   - Anti-unmount: mountedRef evita setState após desmontagem
//   - Troca de instance: limpa selectedConversationId e conversations imediatamente
//   - companyId ou selectedInstanceId ausentes: zero request, estado limpo
//   - Realtime guard company A→B: activeCompanyRef rastreia company ativa
//   - Realtime guard instance A→B: activeInstanceRef rastreia instance ativa
//   - Eventos tardios de channels anteriores descartados antes de load()
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { metaWhatsAppApi }                          from '../../services/metaWhatsAppApi'
import { supabase }                                 from '../../lib/supabase'
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

  // ── Realtime — MVP3E B2: sinal de invalidação UPDATE em meta_conversations ─
  //
  // Propósito: detectar atualizações de conversas (last_message_preview,
  //   last_message_at, unread_count) causadas por mensagens inbound, sem polling.
  //
  // Estratégia: invalidation-only.
  //   O payload do evento NÃO é aplicado ao estado — nenhum merge local.
  //   Apenas dispara load() — o GET canônico determina o estado final.
  //   Ordenação e preview sempre refletem o backend.
  //
  // Filtro: company_id=eq.<companyId>
  //   Supabase postgres_changes suporta apenas um filtro simples (sem AND).
  //   Portanto, UPDATEs de qualquer instância da company chegam ao channel.
  //   Um GET desnecessário pode ocorrer se outra instância da mesma company
  //   for atualizada — aceito como trade-off no MVP3E B2.
  //   Segurança real: RLS meta_conversations_select_meta_view.
  //   GET usa selectedInstanceId como parâmetro → retorna apenas conversas corretas.
  //
  // Guard company A→B / instance A→B:
  //   activeCompanyRef e activeInstanceRef rastreiam os valores ativos.
  //   Atualizados sincronamente durante render (sem useEffect intermediário).
  //   capturedCompanyId e capturedInstanceId são capturados no closure do effect.
  //   Handler descarta evento se qualquer ref divergir — não confia somente no
  //   unsubscribe assíncrono do Supabase client.
  //
  // Outbound: send.js não atualiza meta_conversations → B2 não cobre outbound.
  //   Débito técnico documentado; fora do escopo de B2.
  //
  // Cleanup: channel.unsubscribe() — padrão consolidado do projeto.

  // Refs que rastreiam company/instance atualmente renderizados.
  // Atualização síncrona durante render — sem janela de stale.
  const activeCompanyRef  = useRef(companyId)
  activeCompanyRef.current  = companyId

  const activeInstanceRef = useRef(selectedInstanceId)
  activeInstanceRef.current = selectedInstanceId

  useEffect(() => {
    if (!companyId || !selectedInstanceId) return

    // Capturar valores no momento da criação do channel.
    // Handler compara com refs para rejeitar eventos tardios.
    const capturedCompanyId  = companyId
    const capturedInstanceId = selectedInstanceId

    const channel = supabase
      .channel(`meta_conversations_${companyId}_${selectedInstanceId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'meta_conversations',
          filter: `company_id=eq.${companyId}`,
        },
        (_payload) => {
          // Guard unmount: não disparar load após desmontagem.
          if (!mountedRef.current) return

          // Guard company A→B: descartar evento tardio de company anterior.
          if (activeCompanyRef.current !== capturedCompanyId) return

          // Guard instance A→B: descartar evento de outra instância ou antiga.
          // Nota: eventos de outra instância da mesma company também chegam via
          // filtro company_id — este guard descarta apenas eventos de instâncias
          // diferentes do contexto atual, não é discriminação por `instance_id`
          // no payload (invalidation-only: payload não é acessado).
          if (activeInstanceRef.current !== capturedInstanceId) return

          // Sinal de invalidação — _payload não é source of truth.
          // O GET canônico (com selectedInstanceId) determina o estado final.
          load()
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [companyId, selectedInstanceId, load])

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
