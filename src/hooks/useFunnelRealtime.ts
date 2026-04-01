// =====================================================
// HOOK: useFunnelRealtime
// Fase 4 — Sincronização em tempo real do board
//
// Responsabilidade (limites explícitos):
//   FAZ  → criar e gerenciar subscription Realtime por funil
//   FAZ  → deduplica eventos do próprio usuário (janela de 3s)
//   FAZ  → determinar quais stages foram afetadas (INSERT/UPDATE/DELETE)
//   FAZ  → notificar o caller via callbacks onStagesAffected e onCountsChanged
//   FAZ  → cleanup do canal no unmount ou quando funnelId/companyId mudam
//
//   NÃO FAZ → lógica de fetch (delega para useBoardPositions via callback)
//   NÃO FAZ → atualizar estado do board diretamente (sem acoplamento)
//   NÃO FAZ → reconexão automática com retry (Supabase gerencia internamente)
//   NÃO FAZ → filtrar por stage (emite IDs para o caller decidir o que refrescar)
//
// ISOLAMENTO MULTI-TENANT:
//   O canal filtra por funnel_id=eq.${funnelId} (escopo de subscription).
//   O RLS do Supabase Realtime aplica a policy SELECT de opportunity_funnel_positions
//   antes de despachar qualquer evento — apenas rows onde funnel_id pertence
//   à empresa do JWT (via subquery em sales_funnels) chegam ao cliente.
//
// DEDUPLICAÇÃO — LIMITAÇÃO CONHECIDA:
//   Se outro usuário mover o mesmo card dentro de 3s após uma movimentação
//   local, o evento será ignorado. Inconsistência máxima: 3s. O banco sempre
//   tem o estado correto; a inconsistência é apenas visual e temporária.
//
// DEPENDÊNCIA DE BANCO:
//   Requer REPLICA IDENTITY FULL em opportunity_funnel_positions para que
//   eventos UPDATE incluam old.stage_id (migration 20260404100000).
//   Sem isso, UPDATE cross-stage não limpa a coluna de origem.
// =====================================================

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { FunnelRealtimeEvent } from '../types/sales-funnel'

/** Janela de deduplicação de eventos do próprio usuário (em ms) */
const DEDUPE_WINDOW_MS = 3_000

export interface UseFunnelRealtimeReturn {
  connected: boolean
}

/**
 * @param funnelId    ID do funil aberto — escopo da subscription
 * @param companyId   ID da empresa — validação de pré-condição
 * @param enabled     Feature flag: false desabilita sem erro (rollback rápido)
 * @param onStagesAffected  Callback com IDs das colunas que precisam de refresh
 * @param onCountsChanged   Callback quando contadores mudaram
 * @param recentlyMovedRef  Ref (Map<opportunityId, timestamp>) para dedupe de eventos próprios
 */
export function useFunnelRealtime(
  funnelId: string,
  companyId: string | undefined,
  enabled: boolean,
  onStagesAffected: (stageIds: string[]) => void,
  onCountsChanged: () => void,
  recentlyMovedRef: React.MutableRefObject<Map<string, number>>
): UseFunnelRealtimeReturn {
  const [connected, setConnected] = useState(false)

  // Refs estáveis para callbacks — evitam recriar o canal quando callbacks mudam
  // (callbacks mudam de identidade a cada render, mas o canal não precisa recriar)
  const onStagesAffectedRef = useRef(onStagesAffected)
  onStagesAffectedRef.current = onStagesAffected

  const onCountsChangedRef = useRef(onCountsChanged)
  onCountsChangedRef.current = onCountsChanged

  useEffect(() => {
    if (!enabled || !funnelId || !companyId) return

    // Canal único por funil + company para evitar conflitos de nome
    const channelId = `funnel-positions-${funnelId}-${companyId}`

    const channel = supabase
      .channel(channelId)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'public',
          table: 'opportunity_funnel_positions',
          filter: `funnel_id=eq.${funnelId}`
        },
        (payload: unknown) => {
          const event = payload as FunnelRealtimeEvent

          // ----------------------------------------------------------------
          // DEDUPLICAÇÃO — ignora eventos gerados pelo próprio usuário
          // recentlyMovedRef.current é um Map<opportunityId, timestamp>
          // preenchido em FunnelBoard após cada move() bem-sucedido.
          // ----------------------------------------------------------------
          const opportunityId = event.new?.opportunity_id ?? event.old?.opportunity_id
          if (opportunityId) {
            const movedAt = recentlyMovedRef.current.get(opportunityId)
            if (movedAt && Date.now() - movedAt < DEDUPE_WINDOW_MS) return
          }

          // ----------------------------------------------------------------
          // DETERMINA QUAIS ETAPAS FORAM AFETADAS
          // INSERT  → nova coluna de destino + contadores
          // UPDATE mesma stage  → apenas aquela coluna (reordenação)
          // UPDATE cross-stage  → coluna de origem + destino + contadores
          //                       (requer old.stage_id via REPLICA IDENTITY FULL)
          // DELETE  → coluna de origem + contadores
          // ----------------------------------------------------------------
          const affectedStages = new Set<string>()
          let countsChanged = false

          if (event.eventType === 'INSERT') {
            if (event.new?.stage_id) affectedStages.add(event.new.stage_id)
            countsChanged = true
          } else if (event.eventType === 'UPDATE') {
            const newStage = event.new?.stage_id
            const oldStage = event.old?.stage_id
            if (newStage) affectedStages.add(newStage)
            if (oldStage && oldStage !== newStage) {
              affectedStages.add(oldStage)
              countsChanged = true
            }
          } else if (event.eventType === 'DELETE') {
            if (event.old?.stage_id) affectedStages.add(event.old.stage_id)
            countsChanged = true
          }

          if (affectedStages.size > 0) {
            onStagesAffectedRef.current([...affectedStages])
          }
          if (countsChanged) {
            onCountsChangedRef.current()
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setConnected(true)
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          setConnected(false)
        }
      })

    return () => {
      setConnected(false)
      supabase.removeChannel(channel)
    }
    // recentlyMovedRef é um React.MutableRefObject — identidade estável,
    // não precisa ser dep de recriação do canal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, funnelId, companyId])

  return { connected }
}
