// =====================================================
// useAlertSettings
//
// Carrega e salva configurações personalizadas de alertas do dashboard.
//
// Expõe:
//   settings   — configurações atuais da empresa (ou defaults globais)
//   isDefault  — true = empresa sem linha salva, dados refletem defaults globais
//   updatedAt  — ISO 8601 da última gravação; null se is_default = true
//   loading    — carregamento inicial em andamento
//   saving     — POST em andamento
//   error      — mensagem do último erro (load ou save); null se nenhum
//   load()     — força recarregamento a partir da API
//   save()     — envia seções alteradas ao backend; retorna true se salvo
//   reset()    — restaura settings ao último estado carregado do servidor
//
// Regras:
//   • load() e save() são no-op se companyId for null
//   • save() retorna false se companyId for null
//   • Nenhuma validação de limites no frontend — backend é fonte de verdade
//   • Erros de rede/API são capturados e expostos em error (nunca lançados)
//   • reset() usa lastLoaded ref — nunca valores hardcoded de defaults
// =====================================================

import { useState, useCallback, useEffect, useRef } from 'react'
import { dashboardApi } from '../../services/dashboardApi'
import type { AlertSettings } from '../../types/dashboard'

export interface UseAlertSettingsReturn {
  /**
   * Configurações atuais da empresa.
   * null apenas durante o carregamento inicial (antes do primeiro load() completar).
   * Após carga bem-sucedida: sempre populado, mesmo que is_default = true.
   */
  settings:  AlertSettings | null

  /**
   * true  = empresa sem linha salva; settings reflete os GLOBAL_DEFAULTS do backend.
   * false = empresa tem linha própria em dashboard_alert_settings.
   */
  isDefault: boolean

  /**
   * ISO 8601 da última gravação via save().
   * null quando is_default = true (sem linha salva).
   */
  updatedAt: string | null

  /** Carregamento inicial ou reload manual em andamento. */
  loading:   boolean

  /** POST em andamento (save() chamado e aguardando resposta). */
  saving:    boolean

  /** Mensagem do último erro de load() ou save(). null se nenhum. */
  error:     string | null

  /**
   * Força recarregamento das configurações a partir da API.
   * No-op se companyId for null.
   */
  load:      () => Promise<void>

  /**
   * Envia configurações parciais ao backend (upsert por company_id).
   * Cada seção presente deve estar completa — o backend valida os campos.
   * Seções ausentes mantêm o valor atual no banco (merge feito pelo backend).
   * Retorna true se o save foi bem-sucedido; false em caso de erro ou companyId nulo.
   */
  save:      (data: Partial<AlertSettings>) => Promise<boolean>

  /**
   * Restaura settings ao último estado carregado com sucesso do servidor.
   * Útil para cancelar edições no modal sem precisar recarregar a API.
   * No-op se nunca houve um load bem-sucedido.
   */
  reset:     () => void
}

export function useAlertSettings(companyId: string | null): UseAlertSettingsReturn {
  const [settings,  setSettings]  = useState<AlertSettings | null>(null)
  const [isDefault, setIsDefault] = useState(true)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  // Referência para reset() — armazena o último estado carregado com sucesso
  const lastLoaded = useRef<AlertSettings | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return

    setLoading(true)
    setError(null)

    try {
      const res = await dashboardApi.getAlertSettings(companyId)
      setSettings(res.data)
      setIsDefault(res.meta.is_default)
      setUpdatedAt(res.meta.updated_at ?? null)
      lastLoaded.current = res.data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar configurações de alertas')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  // Carrega automaticamente ao montar e quando companyId muda
  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async (data: Partial<AlertSettings>): Promise<boolean> => {
    if (!companyId) return false

    setSaving(true)
    setError(null)

    try {
      const res = await dashboardApi.saveAlertSettings(companyId, data)
      setSettings(res.data)
      setIsDefault(res.meta.is_default)
      setUpdatedAt(res.meta.updated_at ?? null)
      lastLoaded.current = res.data
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar configurações de alertas')
      return false
    } finally {
      setSaving(false)
    }
  }, [companyId])

  const reset = useCallback(() => {
    if (lastLoaded.current !== null) {
      setSettings({ ...lastLoaded.current })
    }
  }, [])

  return { settings, isDefault, updatedAt, loading, saving, error, load, save, reset }
}
