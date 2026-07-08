// =====================================================
// useContactCycleReasons
//
// Gerencia a lista de motivos de tentativa de contato da empresa.
//
// Expõe:
//   reasons   — lista atual (ativa ou completa, conforme canManage)
//   loading   — carregamento inicial em andamento
//   saving    — operação de escrita em andamento
//   error     — mensagem do último erro; null se nenhum
//   refresh() — força recarregamento
//   create()  — cria motivo com validação client-side; retorna item criado ou null
//   update()  — edita label ou altera active; retorna true se salvo
//
// Regras:
//   • canManage=true  → inclui inativos (admin+)
//   • canManage=false → apenas ativos (seller)
//   • Erro 409 de label duplicado → mensagem amigável específica
//   • label: obrigatório, não vazio, ≤ 80 chars
//   • Nenhum DELETE físico — desativar via update({ active: false })
// =====================================================

import { useState, useCallback, useEffect } from 'react'
import { contactCycleApi } from '../services/contactCycleApi'
import type { ContactAttemptReason, ContactAttemptReasonForm, ContactAttemptReasonPatch } from '../types/contact-cycles'

const MAX_LABEL_LENGTH = 80
const DUPLICATE_LABEL_ERROR = 'Já existe um motivo com este nome'

export interface UseContactCycleReasonsReturn {
  reasons:  ContactAttemptReason[]
  loading:  boolean
  saving:   boolean
  error:    string | null
  refresh:  () => Promise<void>
  create:   (form: ContactAttemptReasonForm) => Promise<ContactAttemptReason | null>
  update:   (reasonId: string, patch: ContactAttemptReasonPatch) => Promise<boolean>
}

export function useContactCycleReasons(
  companyId: string | null,
  canManage: boolean,
): UseContactCycleReasonsReturn {
  const [reasons,  setReasons]  = useState<ContactAttemptReason[]>([])
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      // Admin+ vê inativos para poder reativá-los; seller vê apenas ativos
      const data = await contactCycleApi.listReasons(companyId, canManage)
      // #region agent log
      console.log('[DEBUG:H-A/C] setReasons data', { type: typeof data, isArray: Array.isArray(data), keys: data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data as object) : null, length: Array.isArray(data) ? (data as unknown[]).length : null })
      // #endregion
      setReasons(data)
    } catch (err) {
      // #region agent log
      console.log('[DEBUG:H-B/D] listReasons catch', { err: String(err) })
      // #endregion
      setError(err instanceof Error ? err.message : 'Erro ao carregar motivos de contato')
    } finally {
      setLoading(false)
    }
  }, [companyId, canManage])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const validateLabel = (label: string): string | null => {
    const trimmed = label.trim()
    if (!trimmed) return 'O nome do motivo é obrigatório'
    if (trimmed.length > MAX_LABEL_LENGTH) return `O nome deve ter no máximo ${MAX_LABEL_LENGTH} caracteres`
    return null
  }

  const create = useCallback(async (
    form: ContactAttemptReasonForm,
  ): Promise<ContactAttemptReason | null> => {
    if (!companyId) return null

    // ── Validação client-side ─────────────────────────────────
    const labelError = validateLabel(form.label)
    if (labelError) {
      setError(labelError)
      return null
    }

    setSaving(true)
    setError(null)
    try {
      const created = await contactCycleApi.createReason(companyId, {
        label: form.label.trim(),
      })
      // Atualização otimista: adiciona ao topo da lista
      setReasons(prev => [created, ...prev])
      return created
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      // HTTP 409 do backend → constraint UNIQUE (company_id, label)
      if (msg.includes('409') || msg.toLowerCase().includes('conflict') || msg.toLowerCase().includes('unique')) {
        setError(DUPLICATE_LABEL_ERROR)
      } else {
        setError(msg || 'Erro ao criar motivo de contato')
      }
      return null
    } finally {
      setSaving(false)
    }
  }, [companyId])

  const update = useCallback(async (
    reasonId: string,
    patch: ContactAttemptReasonPatch,
  ): Promise<boolean> => {
    if (!companyId) return false

    // ── Validação client-side (apenas se label estiver no patch) ──
    if (patch.label !== undefined) {
      const labelError = validateLabel(patch.label)
      if (labelError) {
        setError(labelError)
        return false
      }
      patch = { ...patch, label: patch.label.trim() }
    }

    setSaving(true)
    setError(null)
    try {
      await contactCycleApi.updateReason(companyId, reasonId, patch)
      // Atualiza localmente sem novo fetch para UX mais ágil
      setReasons(prev =>
        prev.map(r => r.id === reasonId ? { ...r, ...patch } : r),
      )
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('409') || msg.toLowerCase().includes('conflict') || msg.toLowerCase().includes('unique')) {
        setError(DUPLICATE_LABEL_ERROR)
      } else {
        setError(msg || 'Erro ao atualizar motivo de contato')
      }
      return false
    } finally {
      setSaving(false)
    }
  }, [companyId])

  return { reasons, loading, saving, error, refresh, create, update }
}
