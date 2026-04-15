// Seção de configuração de leads duplicados e reentrada no funil.
// Persistência via PUT /api/companies/:id/lead-config.
// Acesso: apenas administradores da empresa.

import React, { useState, useEffect } from 'react'
import { HelpCircle, X, Save, RefreshCw, AlertCircle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'

interface DuplicateLeadConfig {
  won: string
  lost: string
  open: string
}

interface LeadConfig {
  enabled: boolean
  duplicate_lead_config: DuplicateLeadConfig
}

const WON_OPTIONS = [
  { value: 'EVENT_ONLY', label: 'Apenas registrar entrada', tooltip: 'Registra a nova entrada sem mover ou alterar a oportunidade ganha' },
  { value: 'NEW_OPPORTUNITY', label: 'Criar nova oportunidade', tooltip: 'Cria uma nova oportunidade para o mesmo lead' },
]

const LOST_OPTIONS = [
  { value: 'REOPEN', label: 'Reabrir oportunidade', tooltip: 'Reabre a oportunidade perdida e reposiciona no início do funil' },
  { value: 'NEW_OPPORTUNITY', label: 'Criar nova oportunidade', tooltip: 'Cria uma nova oportunidade, mantendo o histórico da anterior' },
  { value: 'EVENT_ONLY', label: 'Apenas registrar entrada', tooltip: 'Registra a nova entrada sem alterar a oportunidade perdida' },
]

const OPEN_OPTIONS = [
  { value: 'EVENT_ONLY', label: 'Apenas registrar entrada', tooltip: 'Registra a entrada sem mover a oportunidade' },
  { value: 'RESET_PIPELINE', label: 'Reiniciar no funil', tooltip: 'Mantém a oportunidade aberta, mas reposiciona no início do funil' },
  { value: 'NEW_OPPORTUNITY', label: 'Criar nova oportunidade', tooltip: 'Cria uma nova oportunidade para o mesmo lead' },
  { value: 'IGNORE', label: 'Ignorar', tooltip: 'Não faz nada na oportunidade — apenas registra a entrada' },
]

interface SelectWithTooltipProps {
  label: string
  value: string
  options: Array<{ value: string; label: string; tooltip: string }>
  onChange: (v: string) => void
  disabled?: boolean
}

const SelectWithTooltip: React.FC<SelectWithTooltipProps> = ({ label, value, options, onChange, disabled }) => {
  const selectedOpt = options.find(o => o.value === value)
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {selectedOpt && (
        <p className="text-xs text-gray-500 mt-0.5">{selectedOpt.tooltip}</p>
      )}
    </div>
  )
}

const HELP_CONTENT = `
**O que é um lead duplicado?**
Acontece quando a mesma pessoa entra pelo sistema mais de uma vez — por exemplo, preenchendo um formulário pela segunda vez ou enviando uma mensagem no WhatsApp após um período.

**O que é reentrada no funil?**
É quando um lead que já estava no seu processo comercial retorna com interesse. O sistema registra essa nova entrada e pode tomar uma ação automática, conforme sua configuração.

**O que o sistema sempre faz?**
Independente da configuração, toda reentrada é registrada no histórico do lead. Você sempre poderá ver quando e como o lead voltou.

**Oportunidade GANHA:**
O lead foi convertido. Configurando "apenas registrar entrada", o sistema não mexe na oportunidade ganha. Configurando "criar nova oportunidade", uma nova oportunidade é aberta para esse novo ciclo.

**Oportunidade PERDIDA:**
Você pode reabrir a oportunidade anterior (e o lead volta ao início do funil) ou criar uma oportunidade nova. "Apenas registrar entrada" mantém tudo como está.

**Oportunidade ABERTA:**
O lead ainda está no processo. Você pode simplesmente registrar a entrada, reiniciar no funil (sem criar nova oportunidade), criar uma nova ou ignorar a reentrada.
`

export const LeadReentryConfigSection: React.FC = () => {
  const { company } = useAuth()
  const [config, setConfig] = useState<LeadConfig>({
    enabled: true,
    duplicate_lead_config: { won: 'NEW_OPPORTUNITY', lost: 'REOPEN', open: 'EVENT_ONLY' },
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    if (!company?.id) return
    const fetchConfig = async () => {
      setLoading(true)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) return
        const res = await fetch(`/api/companies/${company.id}/lead-config`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (res.ok) {
          const json = await res.json()
          if (json.config) setConfig(json.config)
        }
      } catch {
        // Silencioso — usa default
      } finally {
        setLoading(false)
      }
    }
    fetchConfig()
  }, [company?.id])

  const handleSave = async () => {
    if (!company?.id) return
    setSaving(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setError('Sessão expirada'); return }
      const res = await fetch(`/api/companies/${company.id}/lead-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(config),
      })
      if (!res.ok) {
        const json = await res.json()
        setError(json.error || 'Erro ao salvar configuração')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setError('Erro de conexão')
    } finally {
      setSaving(false)
    }
  }

  const updateRule = (key: keyof DuplicateLeadConfig, value: string) => {
    setConfig(prev => ({
      ...prev,
      duplicate_lead_config: { ...prev.duplicate_lead_config, [key]: value },
    }))
  }

  return (
    <div className="border border-gray-200 rounded-xl p-5 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-600" />
            <h3 className="text-base font-semibold text-gray-900">Leads Duplicados e Reentrada</h3>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Defina como sua empresa deseja tratar leads duplicados e reentradas no funil.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-800 px-3 py-1.5 rounded-lg border border-indigo-200 hover:bg-indigo-50 transition-colors flex-shrink-0"
        >
          <HelpCircle className="w-4 h-4" />
          Como funciona?
        </button>
      </div>

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="h-8 bg-gray-100 rounded-lg" />
          <div className="h-8 bg-gray-100 rounded-lg" />
        </div>
      ) : (
        <>
          {/* Toggle habilitado */}
          <div className="flex items-center justify-between py-2 border-b border-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-800">Funcionalidade ativa</p>
              <p className="text-xs text-gray-500">Quando desativado, reentradas não geram ações automáticas</p>
            </div>
            <button
              type="button"
              onClick={() => setConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.enabled ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  config.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Regras por status */}
          {config.enabled && (
            <div className="space-y-4">
              <p className="text-sm font-medium text-gray-700">Comportamento por status da oportunidade</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Oportunidade Ganha</p>
                  <SelectWithTooltip
                    label=""
                    value={config.duplicate_lead_config.won}
                    options={WON_OPTIONS}
                    onChange={v => updateRule('won', v)}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Oportunidade Perdida</p>
                  <SelectWithTooltip
                    label=""
                    value={config.duplicate_lead_config.lost}
                    options={LOST_OPTIONS}
                    onChange={v => updateRule('lost', v)}
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Oportunidade Aberta</p>
                  <SelectWithTooltip
                    label=""
                    value={config.duplicate_lead_config.open}
                    options={OPEN_OPTIONS}
                    onChange={v => updateRule('open', v)}
                  />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Salvando...' : 'Salvar configuração'}
            </button>
            {saved && (
              <span className="text-sm text-green-600 font-medium">Configuração salva!</span>
            )}
          </div>
        </>
      )}

      {/* Modal de ajuda */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-40">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Como funciona a reentrada de leads?</h3>
              <button
                onClick={() => setShowHelp(false)}
                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-gray-700">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="font-medium text-amber-800 mb-1">O que é um lead duplicado?</p>
                <p>Acontece quando a mesma pessoa entra pelo sistema mais de uma vez — por exemplo, preenchendo um formulário pela segunda vez ou enviando uma mensagem no WhatsApp após um período.</p>
              </div>

              <div>
                <p className="font-medium text-gray-900 mb-1">O que o sistema sempre faz?</p>
                <p>Independente da configuração, toda reentrada é registrada no histórico do lead. Você sempre poderá ver quando e como o lead voltou.</p>
              </div>

              <div>
                <p className="font-medium text-emerald-700 mb-1">Oportunidade GANHA</p>
                <p>O lead foi convertido. Você pode apenas registrar a nova entrada sem alterar nada, ou criar uma nova oportunidade para esse novo ciclo comercial.</p>
              </div>

              <div>
                <p className="font-medium text-red-600 mb-1">Oportunidade PERDIDA</p>
                <p>Você pode reabrir a oportunidade anterior (o lead volta ao início do funil), criar uma oportunidade nova, ou simplesmente registrar a entrada sem alterar nada.</p>
              </div>

              <div>
                <p className="font-medium text-blue-600 mb-1">Oportunidade ABERTA</p>
                <p>O lead ainda está no processo. Você pode registrar a entrada, reiniciar no funil (sem criar nova oportunidade), criar uma nova, ou ignorar completamente.</p>
              </div>

              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="font-medium text-gray-800 mb-1">Exemplo prático</p>
                <p>Um lead preenche o formulário, é perdido e depois preenche novamente. Com a configuração <strong>Perdida → Reabrir</strong>, o sistema reabre a oportunidade e move o lead de volta ao início do funil, registrando um evento "Reentrada no funil" na linha do tempo.</p>
              </div>
            </div>

            <button
              onClick={() => setShowHelp(false)}
              className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
