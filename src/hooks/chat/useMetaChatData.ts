// =============================================================================
// useMetaChatData
//
// Hook isolado para leitura de conversas Meta WhatsApp no Chat.
//
// Responsabilidade (MVP3C.2 + MVP3E B2 + MVP3E B2.1):
//   - Receber companyId + selectedInstanceId (Meta)
//   - Buscar conversas via metaWhatsAppApi.getConversations()
//   - Manter estado: conversations, loading, error, selectedConversationId
//   - Permitir seleção de conversa (estado local)
//   - Refresh explícito
//   - Limpar estado corretamente quando company/instance mudar
//   - Realtime: subscription UPDATE em meta_conversations → sinal de invalidação
//     silencioso (MVP3E B2.1 — sem flicker, sem spinner durante atualização RT)
//
// Estratégia de fetch (B2.1):
//   - performFetch({ silent }) — única implementação do GET
//   - load()       = performFetch({ silent: false }) → initial + troca + refresh manual
//   - loadSilent() = performFetch({ silent: true  }) → somente Realtime
//
// Fora do escopo:
//   - Busca de messages (useMetaChatMessages — B1)
//   - unread mutation, optimistic updates
//   - Outbound sidebar update (send.js não atualiza meta_conversations — débito)
//
// Proteções:
//   - fetchCountRef (compartilhado): arbitra setConversations — apenas fetch mais
//     recente pode atualizar a lista (normal e silent compartilham o mesmo contador)
//   - normalFetchCountRef (exclusivo do load normal): arbitra setLoading(false) —
//     silent nunca liga nem desliga loading; load normal antigo não desliga loading
//     de load normal mais novo
//   - mountedRef: evita setState após desmontagem
//   - Troca de instance: limpa selectedConversationId e conversations imediatamente
//   - companyId ou selectedInstanceId ausentes: zero request, estado limpo
//   - Realtime guard company A→B: activeCompanyRef rastreia company ativa
//   - Realtime guard instance A→B: activeInstanceRef rastreia instance ativa
//   - Eventos tardios de channels anteriores descartados antes de loadSilent()
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

  // ── Contadores de fetch ────────────────────────────────────────────────────
  //
  // fetchCountRef (compartilhado — normal + silent):
  //   Arbitra qual resposta pode atualizar conversations.
  //   Incrementado a cada fetch (normal ou silent).
  //   Resposta stale: currentFetch !== fetchCountRef.current → descartada.
  //
  // normalFetchCountRef (exclusivo de fetches não-silent):
  //   Arbitra quando setLoading(false) pode ser chamado.
  //   Incrementado apenas por load normal.
  //   Garante:
  //     1. silent nunca liga nem desliga loading
  //     2. load normal antigo não desliga loading de load normal mais novo
  //     3. silent não pode "roubar" o slot e deixar loading preso

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
  // silent=false (load normal): reseta estado + exibe loading antes do GET.
  // silent=true  (loadSilent):  mantém estado atual + GET silencioso em background.
  //
  // Ambos usam fetchCountRef para arbitrar setConversations.
  // Somente normal usa normalFetchCountRef para arbitrar setLoading.

  const performFetch = useCallback(({ silent }: { silent: boolean }) => {
    // Sem IDs: somente load normal reseta estado; silent não interfere.
    if (!companyId || !selectedInstanceId) {
      if (!silent) {
        setConversations([])
        setLoading(false)
        setError(null)
      }
      return
    }

    // Normal: limpar estado antigo e sinalizar loading.
    // Silent: manter conversations atuais visíveis durante o GET.
    if (!silent) {
      setConversations([])
      setError(null)
      setLoading(true)
    }

    // Slot deste fetch no árbitro global de conversas.
    const currentFetch = ++fetchCountRef.current

    // Slot deste fetch no árbitro exclusivo de loading.
    // Silent recebe -1 (nunca bate com um valor real do normalFetchCountRef).
    const currentNormalFetch = silent ? -1 : ++normalFetchCountRef.current

    metaWhatsAppApi
      .getConversations(companyId, { instanceId: selectedInstanceId })
      .then((result) => {
        if (!mountedRef.current)                      return  // desmontado
        if (currentFetch !== fetchCountRef.current)   return  // stale — fetch mais recente ganhou
        setConversations(result)
      })
      .catch((err: unknown) => {
        if (!mountedRef.current)                      return
        if (currentFetch !== fetchCountRef.current)   return
        // Silent error: preservar lista atual silenciosamente.
        // Falha transitória de RT não substitui dados atuais por erro.
        if (!silent) {
          const message =
            err instanceof Error
              ? err.message
              : 'Erro ao carregar conversas Meta WhatsApp'
          setError(message)
        }
      })
      .finally(() => {
        if (!mountedRef.current) return
        // Loading gerenciado exclusivamente por normalFetchCountRef:
        //   - silent nunca executa este bloco (currentNormalFetch === -1)
        //   - load normal só desliga loading se ainda for o mais recente
        //     (guard: currentNormalFetch === normalFetchCountRef.current)
        if (!silent && currentNormalFetch === normalFetchCountRef.current) {
          setLoading(false)
        }
      })
  }, [companyId, selectedInstanceId])

  // ── Wrappers públicos / internos ───────────────────────────────────────────

  // load: initial load + troca company/instance + refresh manual.
  // Produz indicador visual de loading — comportamento original preservado.
  const load = useCallback(
    () => performFetch({ silent: false }),
    [performFetch]
  )

  // loadSilent: exclusivo para Realtime.
  // GET em background — sem spinner, sem limpar conversations.
  const loadSilent = useCallback(
    () => performFetch({ silent: true }),
    [performFetch]
  )

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

  // ── Realtime — MVP3E B2.1: sinal de invalidação silencioso ────────────────
  //
  // Propósito: detectar UPDATEs em meta_conversations (last_message_preview,
  //   last_message_at, unread_count) causados por inbound, sem polling e sem flicker.
  //
  // Estratégia: invalidation-only + silent GET.
  //   O payload do evento NÃO é aplicado ao estado — nenhum merge local.
  //   loadSilent() dispara GET canônico em background.
  //   Lista atual permanece visível enquanto GET executa.
  //   Nova lista substitui atomicamente quando GET resolve.
  //   Nenhum spinner, nenhum loading indicator.
  //
  // Filtro: company_id=eq.<companyId>
  //   Supabase postgres_changes suporta apenas um filtro simples (sem AND).
  //   UPDATEs de qualquer instância da company chegam ao channel.
  //   Guard activeInstanceRef descarta eventos de instância divergente.
  //   GET usa selectedInstanceId → retorna apenas conversas corretas.
  //
  // Guard company A→B / instance A→B:
  //   Refs atualizadas sincronamente durante render (sem useEffect intermediário).
  //   capturedCompanyId/capturedInstanceId capturados no closure do effect.
  //   Handler descarta evento tardio sem depender somente de unsubscribe assíncrono.
  //
  // Outbound: send.js não atualiza meta_conversations — débito técnico documentado.
  //
  // Cleanup: channel.unsubscribe() — padrão consolidado do projeto.

  // Refs atualizadas sincronamente durante render.
  const activeCompanyRef  = useRef(companyId)
  activeCompanyRef.current  = companyId

  const activeInstanceRef = useRef(selectedInstanceId)
  activeInstanceRef.current = selectedInstanceId

  useEffect(() => {
    if (!companyId || !selectedInstanceId) return

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
          // Guard unmount: não disparar GET após desmontagem.
          if (!mountedRef.current) return

          // Guard company A→B: descartar evento tardio de company anterior.
          if (activeCompanyRef.current !== capturedCompanyId) return

          // Guard instance A→B: descartar evento quando instância mudou.
          if (activeInstanceRef.current !== capturedInstanceId) return

          // Sinal de invalidação silencioso — _payload não é source of truth.
          // GET canônico (com selectedInstanceId) determina o estado final.
          // Lista atual permanece visível durante o GET. Sem spinner.
          loadSilent()
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [companyId, selectedInstanceId, loadSilent])

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
