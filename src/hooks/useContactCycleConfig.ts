// =====================================================
// useContactCycleConfig
//
// Carrega e salva a configuração de ciclo de contato da empresa.
//
// Expõe:
//   config    — configuração atual (null enquanto carrega pela 1ª vez)
//   loading   — carregamento inicial em andamento
//   saving    — PUT em andamento
//   error     — mensagem do último erro; null se nenhum
//   refresh() — força recarregamento da API
//   update()  — valida e envia form ao backend; retorna true se salvo
//
// Regras:
//   • load() e update() são no-op se companyId for null
//   • Validação client-side mínima: alinhada com CHECK constraints do banco
//   • eligibility_hours enviado como null quando rule = 'day_change'
//   • Erros de rede/API capturados e expostos em error (nunca lançados)
// =====================================================

import { useState, useCallback, useEffect } from 'react'
import { contactCycleApi } from '../services/contactCycleApi'
import type { ContactCycleConfig, ContactCycleConfigForm, EligibilityRule } from '../types/contact-cycles'

const VALID_ELIGIBILITY_RULES: EligibilityRule[] = ['hours', 'day_change', 'both']

export interface UseContactCycleConfigReturn {
  config:   ContactCycleConfig | null
  loading:  boolean
  saving:   boolean
  error:    string | null
  refresh:  () => Promise<void>
  update:   (form: ContactCycleConfigForm) => Promise<boolean>
}

export function useContactCycleConfig(
  companyId: string | null,
): UseContactCycleConfigReturn {
  const [config,  setConfig]  = useState<ContactCycleConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setError(null)
    try {
      const data = await contactCycleApi.getConfig(companyId)
      setConfig(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar configuração de ciclos')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const update = useCallback(async (form: ContactCycleConfigForm): Promise<boolean> => {
    if (!companyId) return false

    // ── Validação client-side ─────────────────────────────────
    if (!VALID_ELIGIBILITY_RULES.includes(form.eligibility_rule)) {
      setError('Regra de elegibilidade inválida')
      return false
    }

    // eligibility_hours obrigatório (> 0) quando rule usa horas
    const needsHours = form.eligibility_rule === 'hours' || form.eligibility_rule === 'both'
    if (needsHours) {
      if (form.eligibility_hours === null || form.eligibility_hours === undefined) {
        setError('Informe o intervalo em horas para a regra selecionada')
        return false
      }
      if (!Number.isInteger(form.eligibility_hours) || form.eligibility_hours <= 0) {
        setError('O intervalo em horas deve ser um número inteiro maior que zero')
        return false
      }
    }

    // Garantir null (nunca 0) quando rule = 'day_change'
    const normalizedForm: ContactCycleConfigForm = {
      ...form,
      eligibility_hours: needsHours ? form.eligibility_hours : null,
    }

    setSaving(true)
    setError(null)
    try {
      const updated = await contactCycleApi.updateConfig(companyId, normalizedForm)
      setConfig(updated)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configuração de ciclos')
      return false
    } finally {
      setSaving(false)
    }
  }, [companyId])

  return { config, loading, saving, error, refresh, update }
}
