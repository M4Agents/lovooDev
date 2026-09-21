// =============================================================================
// useMetaChatMessages
//
// Hook isolado para leitura de mensagens de uma conversa Meta WhatsApp.
//
// Responsabilidade (MVP3C.4 + MVP3E):
//   - Receber companyId + conversationId
//   - Buscar mensagens via metaWhatsAppApi.getMessages()
//   - Manter estado: messages, loading, error
//   - Refresh explícito
//   - Limpar estado corretamente quando IDs mudarem
//   - Realtime: subscription INSERT em meta_messages → sinal de invalidação
//     (MVP3E B1 — somente conversa aberta; sidebar em B2)
//
// Fora do escopo desta fase:
//   - Paginação histórica ("carregar anteriores")
//   - Realtime para sidebar / meta_conversations (MVP3E B2)
//   - Cursor-based pagination
//
// Proteções:
//   - Anti-stale: fetchCountRef monotônico descarta respostas de fetches anteriores
//   - Anti-unmount: mountedRef evita setState após desmontagem
//   - Invalidação sem fetch: incrementa fetchCountRef ao zerar IDs, garantindo
//     que resposta pendente não reapareça mesmo que resolva depois do null
//   - Troca A→B: limpa messages imediatamente, só aplica resultado do fetch mais recente
//   - Realtime guard A→B: activeConvRef rastreia conversationId ativa; evento
//     tardio de channel de conversa anterior descartado antes de disparar load()
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

  // ── Realtime — MVP3E B1: sinal de invalidação INSERT em meta_messages ─────
  //
  // Propósito: detectar novas mensagens da conversa aberta sem polling.
  //
  // Estratégia: invalidation-only.
  //   O payload do evento NÃO é usado para atualizar mensagens diretamente.
  //   Apenas dispara load() — o GET canônico é a única fonte de dados.
  //   Evita inconsistência entre estado local e backend (ex: ordenação, campos).
  //
  // Segurança:
  //   - Filtro conversation_id=eq.<id> reduz volume de eventos entregues.
  //   - A RLS (meta_messages_select_meta_view) garante isolamento de tenant:
  //     usuário só recebe eventos de rows acessíveis via policy SELECT.
  //   - companyId e conversationId validados antes de criar o channel.
  //   - Nenhum dado do payload é usado para autorização ou SELECT direto.
  //   - Nenhum token, wa_id, meta_message_id ou service_role no handler.
  //
  // Guard A→B (conversa anterior × conversa atual):
  //   activeConvRef.current é mantido sincronizado com o conversationId do
  //   render mais recente (atualizado diretamente, sem useEffect intermediário).
  //   O handler captura capturedConvId no momento da criação do channel e
  //   descarta o evento se activeConvRef.current divergir — não confia somente
  //   no unsubscribe assíncrono do Supabase client para prevenir stale loads.
  //
  // Cleanup:
  //   channel.unsubscribe() — padrão consolidado do projeto (Instagram/Uazapi).
  //   Chamado na função de limpeza do useEffect ao trocar de conversa ou desmontar.
  //
  // Outbound (double-refresh):
  //   MetaChatArea chama refresh() após envio bem-sucedido.
  //   Este channel também pode disparar load() quando o INSERT de saída chega
  //   via Realtime. Para MVP3E B1, o double-refresh é aceito: fetchCountRef
  //   garante que apenas o resultado do fetch mais recente seja aplicado.

  // Ref que rastreia o conversationId ativamente renderizado.
  // Atualização síncrona durante render (sem useEffect) elimina janela de
  // stale entre renders: handler de evento sempre compara com o valor atual.
  const activeConvRef = useRef(conversationId)
  activeConvRef.current = conversationId

  useEffect(() => {
    if (!companyId || !conversationId) return

    // Captura conversationId no momento da criação do channel.
    // O handler compara com activeConvRef.current para rejeitar eventos tardios
    // de conversas já abandonadas, sem depender somente de unsubscribe assíncrono.
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
          // Guard unmount: não disparar load após desmontagem do componente.
          // Evita HTTP call desnecessária quando unsubscribe ainda não propagou.
          if (!mountedRef.current) return

          // Guard A→B: descartar evento tardio de conversa anterior.
          if (activeConvRef.current !== capturedConvId) return

          // Sinal de invalidação — _payload não é source of truth.
          // O GET canônico determina o estado final das mensagens.
          load()
        }
      )
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [companyId, conversationId, load])

  // ── Retorno ───────────────────────────────────────────────────────────────

  return {
    messages,
    loading,
    error,
    refresh: load,
  }
}
