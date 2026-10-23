// =============================================================================
// useMetaWhatsAppInstances
//
// Hook de leitura das instâncias Meta WhatsApp ativas da empresa.
//
// Consome SOMENTE: metaWhatsAppApi.getInstances(companyId)
//
// Contrato:
//   - companyId ausente → nenhuma chamada API, lista vazia imediata
//   - recarrega automaticamente quando companyId mudar
//   - resultado stale da empresa anterior nunca sobrescreve a atual
//     (fetchCountRef descarta respostas de fetches desatualizados)
//   - refresh() disponível para recarga manual
//
// Sem: Supabase direto, Realtime, polling, Uazapi, SDK Meta, alterações globais
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { metaWhatsAppApi }                          from '../services/metaWhatsAppApi'
import type { MetaWhatsAppInstance }                from '../types/meta-whatsapp'

// ── Contrato público do hook ──────────────────────────────────────────────────

export interface UseMetaWhatsAppInstancesResult {
  instances: MetaWhatsAppInstance[]
  loading:   boolean
  error:     string | null
  refresh:   () => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMetaWhatsAppInstances(
  companyId: string | undefined
): UseMetaWhatsAppInstancesResult {
  const [instances, setInstances] = useState<MetaWhatsAppInstance[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Contador monotônico por fetch iniciado.
  // Cada vez que load() é chamado, incrementa.
  // Callbacks assíncronos só aplicam resultado se o número ainda bater —
  // descarta silenciosamente respostas de fetches anteriores (companyId antigo
  // ou refresh manual que foi substituído por outro antes de completar).
  const fetchCountRef = useRef(0)

  // Empresa à qual instances/error/loading atuais pertencem.
  // Sem isso, o primeiro render após trocar companyId ainda devolveria
  // a lista da empresa anterior — useEffect só limpa no commit seguinte.
  const appliedForRef = useRef<string | undefined>(undefined)

  const load = useCallback(() => {
    // companyId ausente → estado inicial limpo, sem chamar API
    if (!companyId) {
      appliedForRef.current = undefined
      setInstances([])
      setLoading(false)
      setError(null)
      return
    }

    // Limpar dados da empresa anterior imediatamente —
    // evita que a UI exiba instâncias de outra empresa enquanto carrega.
    setInstances([])
    setError(null)
    setLoading(true)

    const currentFetch = ++fetchCountRef.current

    metaWhatsAppApi
      .getInstances(companyId)
      .then((result) => {
        if (currentFetch !== fetchCountRef.current) return  // resposta stale — ignorar
        appliedForRef.current = companyId
        setInstances(result)
      })
      .catch((err: unknown) => {
        if (currentFetch !== fetchCountRef.current) return  // resposta stale — ignorar
        appliedForRef.current = companyId
        // Expor somente a mensagem sanitizada do service — nunca o erro bruto de rede.
        const message =
          err instanceof Error
            ? err.message
            : 'Erro ao carregar instâncias Meta WhatsApp'
        setError(message)
      })
      .finally(() => {
        if (currentFetch !== fetchCountRef.current) return  // resposta stale — ignorar
        appliedForRef.current = companyId
        setLoading(false)
      })
  }, [companyId])

  // Dispara load() na montagem e sempre que companyId (ou load) mudar.
  useEffect(() => {
    load()
  }, [load])

  const belongsToCurrent = appliedForRef.current === companyId

  return {
    instances: belongsToCurrent ? instances : [],
    loading:   belongsToCurrent ? loading : Boolean(companyId),
    error:     belongsToCurrent ? error : null,
    refresh:   load,
  }
}
