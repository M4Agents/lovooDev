// =============================================================================
// useMetaChatMessages
//
// Hook isolado para leitura de mensagens de uma conversa Meta WhatsApp.
//
// Responsabilidade (MVP3C.4 + MVP3E B1 + MVP3E B1.1):
//   - Receber companyId + conversationId
//   - Buscar mensagens via metaWhatsAppApi.getMessages()
//   - Manter estado: messages, loading, error
//   - Refresh explícito
//   - Limpar estado corretamente quando IDs mudarem
//   - Realtime: subscription INSERT em meta_messages → sinal de invalidação
//     silencioso (MVP3E B1.1 — sem flicker, sem spinner durante atualização RT)
//
// Estratégia de fetch (B1.1):
//   - performFetch({ silent }) — única implementação do GET
//   - load()       = performFetch({ silent: false }) → initial + troca + refresh explícito
//   - loadSilent() = performFetch({ silent: true  }) → somente Realtime
//
// Fora do escopo:
//   - Paginação histórica ("carregar anteriores")
//   - Realtime para sidebar / meta_conversations (MVP3E B2/B2.1)
//   - Cursor-based pagination
//
// Proteções:
//   - fetchCountRef (compartilhado): arbitra setMessages — apenas fetch mais
//     recente (normal ou silent) pode atualizar a lista
//   - normalFetchCountRef (exclusivo do load normal): arbitra setLoading(false) —
//     silent nunca liga nem desliga loading; load normal antigo não desliga loading
//     de load normal mais novo; silent não pode deixar loading preso em true
//   - mountedRef: evita setState após desmontagem
//   - Invalidação sem fetch: no branch sem IDs, fetchCountRef++ descarta qualquer
//     fetch em andamento (apenas em load normal — silent não passa por aqui)
//   - Troca A→B: setMessages([]) imediato + fetchCountRef garante que apenas o
//     fetch mais recente atualiza state
//   - Realtime guard A→B: activeConvRef rastreia conversationId ativa; evento
//     tardio de channel de conversa anterior descartado antes de loadSilent()
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { metaWhatsAppApi }       from '../../services/metaWhatsAppApi'
import { supabase }              from '../../lib/supabase'
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

  // ── Contadores de fetch ────────────────────────────────────────────────────
  //
  // fetchCountRef (compartilhado — normal + silent):
  //   Arbitra qual resposta pode atualizar messages.
  //   Incrementado a cada fetch real (normal ou silent).
  //   Resposta stale: currentFetch !== fetchCountRef.current → descartada.
  //   Também incrementado (sem fetch) quando IDs se tornam inválidos — invalida
  //   qualquer fetch em andamento sem precisar de AbortController.
  //
  // normalFetchCountRef (exclusivo de fetches não-silent):
  //   Arbitra quando setLoading(false) pode ser chamado.
  //   Incrementado apenas por load normal.
  //   Garantias:
  //     1. silent nunca liga nem desliga loading
  //     2. load normal antigo não desliga loading de load normal mais novo
  //     3. silent "vencendo" fetchCountRef não deixa loading preso em true

  const fetchCountRef       = useRef(0)
  const normalFetchCountRef = useRef(0)

  // Guard de unmount: evita setState após desmontagem do componente.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // ── performFetch — única implementação do GET ──────────────────────────────
  //
  // silent=false (load normal): invalida fetch anterior + reseta estado + loading.
  // silent=true  (loadSilent):  mantém estado atual + GET silencioso em background.
  //
  // Ambos usam fetchCountRef para arbitrar setMessages.
  // Somente normal usa normalFetchCountRef para arbitrar setLoading.

  const performFetch = useCallback(({ silent }: { silent: boolean }) => {
    // Sem IDs: somente load normal invalida fetch anterior e reseta estado.
    // silent não passa por aqui (RT effect verifica IDs antes de chamar loadSilent).
    if (!companyId || !conversationId) {
      if (!silent) {
        fetchCountRef.current++   // invalida qualquer fetch em andamento
        setMessages([])
        setError(null)
        setLoading(false)
      }
      return
    }

    // Normal: limpar estado anterior imediatamente.
    // Silent: manter messages atuais visíveis durante o GET.
    if (!silent) {
      setMessages([])
      setError(null)
      setLoading(true)
    }

    // Slot deste fetch no árbitro global de messages.
    const currentFetch = ++fetchCountRef.current

    // Slot deste fetch no árbitro exclusivo de loading.
    // Silent recebe -1 — nunca bate com um valor real do normalFetchCountRef.
    const currentNormalFetch = silent ? -1 : ++normalFetchCountRef.current

    metaWhatsAppApi
      .getMessages(companyId, conversationId)
      .then((result) => {
        if (!mountedRef.current)                    return  // desmontado
        if (currentFetch !== fetchCountRef.current) return  // stale — fetch mais recente ganhou
        setMessages(result)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current)                    return
        if (currentFetch !== fetchCountRef.current) return
        // Silent error: preservar messages atuais e error visual silenciosamente.
        // Falha transitória de RT não substitui dados visíveis por erro.
        if (!silent) {
          const message =
            err instanceof Error
              ? err.message
              : 'Erro ao carregar mensagens'
          setError(message)
          setMessages([])   // limpar somente em load normal (comportamento original)
        }
      })
      .finally(() => {
        if (!mountedRef.current) return
        // Loading gerenciado exclusivamente por normalFetchCountRef:
        //   - silent nunca executa este bloco (currentNormalFetch === -1 nunca bate)
        //   - load normal só desliga loading se ainda for o mais recente
        if (!silent && currentNormalFetch === normalFetchCountRef.current) {
          setLoading(false)
        }
      })
  }, [companyId, conversationId])

  // ── Wrappers ───────────────────────────────────────────────────────────────

  // load: initial load + troca de conversa + refresh explícito (outbound).
  // Produz indicador visual de loading — comportamento original preservado.
  const load = useCallback(
    () => performFetch({ silent: false }),
    [performFetch]
  )

  // loadSilent: exclusivo para Realtime.
  // GET em background — sem spinner, sem limpar messages.
  const loadSilent = useCallback(
    () => performFetch({ silent: true }),
    [performFetch]
  )

  // ── Disparar busca ao montar e ao mudar company/conversationId ─────────────

  useEffect(() => {
    load()
  }, [load])

  // ── Realtime — MVP3E B1.1: sinal de invalidação INSERT silencioso ──────────
  //
  // Propósito: detectar novas mensagens sem polling e sem flicker.
  //
  // Estratégia: invalidation-only + silent GET.
  //   O payload do evento NÃO é usado para atualizar mensagens diretamente.
  //   loadSilent() dispara GET canônico em background.
  //   Mensagens atuais permanecem visíveis enquanto GET executa.
  //   Nova lista substitui atomicamente quando GET resolve.
  //   Nenhum spinner, nenhum loading indicator.
  //
  // Segurança:
  //   - Filtro conversation_id=eq.<id> reduz volume de eventos.
  //   - RLS (meta_messages_select_meta_view) garante isolamento de tenant.
  //   - companyId e conversationId validados antes de criar o channel.
  //   - Nenhum dado do payload é usado para autorização ou SELECT direto.
  //   - Nenhum token, wa_id, meta_message_id ou service_role no handler.
  //
  // Guard A→B (conversa anterior × conversa atual):
  //   activeConvRef.current mantido sincronizado com o conversationId do render
  //   mais recente. Handler captura capturedConvId e descarta evento se divergir.
  //   Não depende somente do unsubscribe assíncrono do Supabase client.
  //
  // Outbound double-GET:
  //   handleSend chama refresh() = load() normal após send success.
  //   RT INSERT do próprio outbound chega → loadSilent().
  //   normalFetchCountRef garante que o loading do normal seja desligado
  //   corretamente mesmo que o silent resolva primeiro.
  //   O duplo GET é aceito para MVP3E B1.1.
  //
  // Cleanup:
  //   channel.unsubscribe() — padrão consolidado do projeto.

  // Ref que rastreia conversationId ativamente renderizado.
  // Atualizada sincronamente durante render — sem janela de stale.
  const activeConvRef = useRef(conversationId)
  activeConvRef.current = conversationId

  useEffect(() => {
    if (!companyId || !conversationId) return

    // Captura conversationId no closure do effect.
    // Handler compara com activeConvRef para rejeitar eventos tardios.
    const capturedConvId = conversationId

    const channel = supabase
      .channel(`meta_messages_${companyId}_${conversationId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'meta_messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (_payload) => {
          // Guard unmount: não disparar GET após desmontagem.
          if (!mountedRef.current) return

          // Guard A→B: descartar evento tardio de conversa anterior.
          if (activeConvRef.current !== capturedConvId) return

          // Sinal de invalidação silencioso — _payload não é source of truth.
          // GET canônico determina o estado final das mensagens.
          // Messages atuais permanecem visíveis durante o GET. Sem spinner.
          loadSilent()
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [companyId, conversationId, loadSilent])

  // ── Retorno ───────────────────────────────────────────────────────────────

  return {
    messages,
    loading,
    error,
    refresh: load,
  }
}
