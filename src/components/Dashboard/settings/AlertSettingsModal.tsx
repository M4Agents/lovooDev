// =====================================================
// AlertSettingsModal
//
// Modal de configuração dos limiares de alertas do dashboard por empresa.
// Padrão visual: idêntico ao InsightRulesModal (overlay, fixed inset-0, z-50, max-w-lg).
// Fluxo 2 etapas: 'editing' → 'confirming'.
//
// Seções configuráveis:
//   1. SLA sem resposta    (sla_settings)
//   2. Oportunidade parada (stalled_settings)
//   3. Risco de vendedor   (seller_risk_settings)
//
// Unidades de display:
//   • minutos → horas  (min_minutes, critical_minutes, waiting_minutes)
//   • minutos → dias   (idle_minutes)
//   • passthrough      (limit, min_leads, min_probability)
//
// Validações UX (frontend — backend é a fonte de verdade):
//   • Todos os campos numéricos devem ser positivos
//   • critical_hours > min_hours (cross-field, SLA)
//   • Campos limit, min_leads, min_probability devem ser inteiros
//   • Submit bloqueado se inválido ou sem alterações
//
// Refetch após save: via onSaved() no pai (NewDashboard).
// Sem delay artificial — save ok → onSaved() → onClose() imediato.
// =====================================================

import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  X, Save, Loader2, AlertCircle, CheckCircle2,
  Info, ArrowRight, ChevronLeft, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useAlertSettings }    from '../../../hooks/dashboard/useAlertSettings'
import { useAccessControl }    from '../../../hooks/useAccessControl'
import { funnelApi }           from '../../../services/funnelApi'
import type { AlertSettings, FunnelScopeSettings } from '../../../types/dashboard'
import type { SalesFunnel, FunnelStage }           from '../../../types/sales-funnel'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AlertSettingsModalProps {
  isOpen:    boolean
  onClose:   () => void
  /** Chamado imediatamente após save bem-sucedido, antes de fechar o modal. */
  onSaved:   () => void
  companyId: string | null
}

type ModalStep = 'editing' | 'confirming'

// ---------------------------------------------------------------------------
// Tipos de estado local (unidades de display)
// ---------------------------------------------------------------------------

interface FormSla {
  enabled:        boolean
  min_hours:      number   // min_minutes / 60
  critical_hours: number   // critical_minutes / 60
  limit:          number
}

interface FormStalled {
  enabled:         boolean
  idle_days:       number   // idle_minutes / 1440
  min_probability: number   // passthrough (%)
  limit:           number
}

interface FormSellerRisk {
  enabled:       boolean
  waiting_hours: number   // waiting_minutes / 60
  min_leads:     number
  limit:         number
}

interface FormFunnelScope {
  mode:      'all' | 'custom'
  stage_ids: string[]
}

interface FormState {
  sla:         FormSla
  stalled:     FormStalled
  sellerRisk:  FormSellerRisk
  funnelScope: FormFunnelScope
}

interface ValidationErrors {
  sla?:         string
  stalled?:     string
  sellerRisk?:  string
  funnelScope?: string
}

// ---------------------------------------------------------------------------
// Conversão de unidades
// ---------------------------------------------------------------------------

const minsToHours = (m: number): number => Math.round((m / 60) * 10) / 10
const minsToDays  = (m: number): number => Math.round((m / 1440) * 10) / 10
const hoursToMins = (h: number): number => Math.round(h * 60)
const daysToMins  = (d: number): number => Math.round(d * 1440)

function settingsToForm(s: AlertSettings): FormState {
  return {
    sla: {
      enabled:        s.sla_settings.enabled,
      min_hours:      minsToHours(s.sla_settings.min_minutes),
      critical_hours: minsToHours(s.sla_settings.critical_minutes),
      limit:          s.sla_settings.limit,
    },
    stalled: {
      enabled:         s.stalled_settings.enabled,
      idle_days:       minsToDays(s.stalled_settings.idle_minutes),
      min_probability: s.stalled_settings.min_probability,
      limit:           s.stalled_settings.limit,
    },
    sellerRisk: {
      enabled:       s.seller_risk_settings.enabled,
      waiting_hours: minsToHours(s.seller_risk_settings.waiting_minutes),
      min_leads:     s.seller_risk_settings.min_leads,
      limit:         s.seller_risk_settings.limit,
    },
    funnelScope: {
      mode:      s.funnel_scope_settings?.mode ?? 'all',
      stage_ids: s.funnel_scope_settings?.stage_ids ?? [],
    },
  }
}

function formToSettings(f: FormState): AlertSettings {
  return {
    sla_settings: {
      enabled:          f.sla.enabled,
      min_minutes:      hoursToMins(f.sla.min_hours),
      critical_minutes: hoursToMins(f.sla.critical_hours),
      limit:            f.sla.limit,
    },
    stalled_settings: {
      enabled:         f.stalled.enabled,
      idle_minutes:    daysToMins(f.stalled.idle_days),
      min_probability: f.stalled.min_probability,
      limit:           f.stalled.limit,
    },
    seller_risk_settings: {
      enabled:         f.sellerRisk.enabled,
      waiting_minutes: hoursToMins(f.sellerRisk.waiting_hours),
      min_leads:       f.sellerRisk.min_leads,
      limit:           f.sellerRisk.limit,
    },
    funnel_scope_settings: {
      mode:      f.funnelScope.mode,
      stage_ids: f.funnelScope.mode === 'custom' ? f.funnelScope.stage_ids : undefined,
    } as FunnelScopeSettings,
  }
}

// ---------------------------------------------------------------------------
// Validação UX
// ---------------------------------------------------------------------------

function validateForm(f: FormState): ValidationErrors {
  const errors: ValidationErrors = {}

  // SLA
  if (f.sla.min_hours <= 0) {
    errors.sla = 'Tempo mínimo deve ser positivo'
  } else if (f.sla.critical_hours <= f.sla.min_hours) {
    errors.sla = '"Crítico após" deve ser maior que o tempo mínimo'
  } else if (!Number.isInteger(f.sla.limit) || f.sla.limit < 1) {
    errors.sla = 'Limite deve ser um número inteiro positivo'
  }

  // Oportunidade parada
  if (f.stalled.idle_days <= 0) {
    errors.stalled = 'Dias parado deve ser positivo'
  } else if (
    !Number.isInteger(f.stalled.min_probability) ||
    f.stalled.min_probability < 0 ||
    f.stalled.min_probability > 100
  ) {
    errors.stalled = 'Probabilidade mínima deve ser um inteiro entre 0 e 100'
  } else if (!Number.isInteger(f.stalled.limit) || f.stalled.limit < 1) {
    errors.stalled = 'Limite deve ser um número inteiro positivo'
  }

  // Risco de vendedor
  if (f.sellerRisk.waiting_hours <= 0) {
    errors.sellerRisk = 'Tempo de espera deve ser positivo'
  } else if (!Number.isInteger(f.sellerRisk.min_leads) || f.sellerRisk.min_leads < 1) {
    errors.sellerRisk = 'Mínimo de leads deve ser um inteiro positivo'
  } else if (!Number.isInteger(f.sellerRisk.limit) || f.sellerRisk.limit < 1) {
    errors.sellerRisk = 'Limite deve ser um inteiro positivo'
  }

  // Escopo de funil
  if (f.funnelScope.mode === 'custom' && f.funnelScope.stage_ids.length === 0) {
    errors.funnelScope = 'Selecione ao menos uma etapa ou escolha "Todos os funis"'
  }

  return errors
}

// ---------------------------------------------------------------------------
// Sub-componentes
// ---------------------------------------------------------------------------

interface NumericFieldProps {
  label:    string
  hint?:    string
  value:    number
  step?:    number
  unit:     string
  disabled: boolean
  onChange: (v: number) => void
}

function NumericField({ label, hint, value, step = 1, unit, disabled, onChange }: NumericFieldProps) {
  return (
    <div className={disabled ? 'opacity-50' : ''}>
      <label className="block text-sm font-medium text-gray-700 mb-0.5">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-1.5">{hint}</p>}
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const n = parseFloat(e.target.value)
            if (!Number.isNaN(n)) onChange(n)
          }}
          className="w-28 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-50"
        />
        <span className="text-sm text-gray-500">{unit}</span>
      </div>
    </div>
  )
}

interface SectionHeaderProps {
  title:    string
  enabled:  boolean
  canEdit:  boolean
  onToggle: () => void
}

function SectionHeader({ title, enabled, canEdit, onToggle }: SectionHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
      <button
        type="button"
        onClick={onToggle}
        disabled={!canEdit}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none disabled:cursor-not-allowed ${
          enabled ? 'bg-indigo-600' : 'bg-gray-300'
        }`}
        title={enabled ? 'Desativar alerta' : 'Ativar alerta'}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AlertSettingsModal
// ---------------------------------------------------------------------------

export const AlertSettingsModal: React.FC<AlertSettingsModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  companyId,
}) => {
  // Carrega configurações apenas quando o modal está aberto
  const { settings, isDefault, loading, saving, error, save, reset } = useAlertSettings(
    isOpen ? companyId : null,
  )

  const { canManageConversationalAgents: canEdit } = useAccessControl()

  const [form,         setForm]         = useState<FormState | null>(null)
  const [originalForm, setOriginalForm] = useState<FormState | null>(null)
  const [step,         setStep]         = useState<ModalStep>('editing')

  // Estado para o picker de funis/etapas
  const [funnels,        setFunnels]        = useState<SalesFunnel[]>([])
  const [stagesByFunnel, setStagesByFunnel] = useState<Record<string, FunnelStage[]>>({})
  const [loadingFunnels, setLoadingFunnels] = useState(false)
  const [expandedFunnel, setExpandedFunnel] = useState<string | null>(null)

  // Reinicia estados ao abrir
  useEffect(() => {
    if (isOpen) {
      setStep('editing')
      setOriginalForm(null)
      setFunnels([])
      setStagesByFunnel({})
      setExpandedFunnel(null)
    }
  }, [isOpen])

  // Sincroniza form quando settings carregam pela primeira vez
  useEffect(() => {
    if (settings && !originalForm) {
      const initial = settingsToForm(settings)
      setForm(initial)
      setOriginalForm(initial)
    }
  }, [settings, originalForm])

  // Carrega funis quando modo custom é ativado (lazy)
  const loadFunnels = useCallback(async () => {
    if (!companyId || funnels.length > 0) return
    setLoadingFunnels(true)
    try {
      // #region agent log
      console.log('[debug:loadFunnels] calling getFunnels with companyId=', companyId)
      // #endregion
      const data = await funnelApi.getFunnels(companyId)
      // #region agent log
      console.log('[debug:loadFunnels] getFunnels returned count=', data?.length, 'data=', data)
      // #endregion
      setFunnels(data)
    } catch (err) {
      // #region agent log
      console.log('[debug:loadFunnels] getFunnels THREW error=', err)
      // #endregion
    } finally {
      setLoadingFunnels(false)
    }
  }, [companyId, funnels.length])

  // Carrega etapas de um funil ao expandir no accordion
  const loadStagesForFunnel = useCallback(async (funnelId: string) => {
    if (stagesByFunnel[funnelId]) return
    try {
      const stages = await funnelApi.getStages(funnelId)
      setStagesByFunnel(prev => ({ ...prev, [funnelId]: stages }))
    } catch {
      setStagesByFunnel(prev => ({ ...prev, [funnelId]: [] }))
    }
  }, [stagesByFunnel])

  // useMemo antes de qualquer early return (Rules of Hooks)
  const validationErrors: ValidationErrors = useMemo(
    () => (form ? validateForm(form) : {}),
    [form],
  )

  const isValid = Object.keys(validationErrors).length === 0

  const hasChanges = useMemo(() => {
    if (!form || !originalForm) return false
    return JSON.stringify(formToSettings(form)) !== JSON.stringify(formToSettings(originalForm))
  }, [form, originalForm])

  const changedSections = useMemo(() => {
    if (!form || !originalForm) return []
    const orig = formToSettings(originalForm)
    const curr = formToSettings(form)
    const result: string[] = []
    if (JSON.stringify(orig.sla_settings)          !== JSON.stringify(curr.sla_settings))          result.push('SLA sem resposta')
    if (JSON.stringify(orig.stalled_settings)       !== JSON.stringify(curr.stalled_settings))       result.push('Oportunidade parada')
    if (JSON.stringify(orig.seller_risk_settings)   !== JSON.stringify(curr.seller_risk_settings))   result.push('Risco de vendedor')
    if (JSON.stringify(orig.funnel_scope_settings)  !== JSON.stringify(curr.funnel_scope_settings))  result.push('Escopo para Oportunidades Paradas')
    return result
  }, [form, originalForm])

  if (!isOpen) return null

  // ---------------------------------------------------------------------------
  // Helpers de atualização do form
  // ---------------------------------------------------------------------------

  function setSla(patch: Partial<FormSla>) {
    setForm((prev) => prev ? { ...prev, sla: { ...prev.sla, ...patch } } : prev)
  }

  function setStalled(patch: Partial<FormStalled>) {
    setForm((prev) => prev ? { ...prev, stalled: { ...prev.stalled, ...patch } } : prev)
  }

  function setSellerRisk(patch: Partial<FormSellerRisk>) {
    setForm((prev) => prev ? { ...prev, sellerRisk: { ...prev.sellerRisk, ...patch } } : prev)
  }

  function setFunnelScope(patch: Partial<FormFunnelScope>) {
    setForm((prev) => prev ? { ...prev, funnelScope: { ...prev.funnelScope, ...patch } } : prev)
  }

  function handleToggleStage(stageId: string) {
    setFunnelScope({
      stage_ids: form?.funnelScope.stage_ids.includes(stageId)
        ? form.funnelScope.stage_ids.filter(id => id !== stageId)
        : [...(form?.funnelScope.stage_ids ?? []), stageId],
    })
  }

  function handleToggleFunnelAll(funnelId: string, stages: FunnelStage[]) {
    const allIds = stages.map(s => s.id)
    const currentIds = form?.funnelScope.stage_ids ?? []
    const allSelected = allIds.every(id => currentIds.includes(id))
    setFunnelScope({
      stage_ids: allSelected
        ? currentIds.filter(id => !allIds.includes(id))
        : [...currentIds, ...allIds.filter(id => !currentIds.includes(id))],
    })
  }

  function handleRequestSave() {
    if (!form || !hasChanges || !isValid) return
    setStep('confirming')
  }

  async function handleConfirmSave() {
    if (!form) return
    const ok = await save(formToSettings(form))
    if (ok) {
      onSaved()   // refetch no pai — imediato, sem delay
      onClose()
    }
  }

  function handleReset() {
    reset()
    if (settings) {
      const fresh = settingsToForm(settings)
      setForm(fresh)
      setOriginalForm(fresh)
    }
  }

  // ---------------------------------------------------------------------------
  // Passo: confirming
  // ---------------------------------------------------------------------------

  if (step === 'confirming') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col">
          {/* Cabeçalho */}
          <div className="flex items-start justify-between p-5 border-b border-gray-100">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Confirmar alterações</h2>
              <p className="text-xs text-gray-500 mt-0.5">Revise o que será alterado antes de salvar.</p>
            </div>
            <button type="button" onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <X size={18} />
            </button>
          </div>

          {/* Corpo */}
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-700 font-medium">Seções alteradas:</p>

            <ul className="space-y-2">
              {changedSections.map((section) => (
                <li key={section} className="flex items-center gap-2 text-sm">
                  <ArrowRight size={13} className="text-indigo-500 flex-shrink-0" />
                  <span className="font-medium text-gray-800">{section}</span>
                </li>
              ))}
            </ul>

            <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5">
              <Info size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">
                Após salvar, os alertas do dashboard serão atualizados com as novas regras.
              </p>
            </div>

            {error && !saving && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                <AlertCircle size={14} className="flex-shrink-0" />
                {error}
              </div>
            )}
          </div>

          {/* Rodapé */}
          <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
            <button
              type="button"
              onClick={() => setStep('editing')}
              disabled={saving}
              className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50 transition-colors"
            >
              <ChevronLeft size={15} />
              Voltar para editar
            </button>

            <button
              type="button"
              onClick={handleConfirmSave}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {saving
                ? <><Loader2 size={14} className="animate-spin" /> Salvando...</>
                : <><Save size={14} /> Confirmar e salvar</>
              }
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // Passo: editing
  // ---------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Cabeçalho */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Configurar alertas do dashboard</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-gray-500">Regras aplicadas a esta empresa.</p>
              {isDefault && (
                <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                  Configuração padrão
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400 gap-2 text-sm">
              <Loader2 size={18} className="animate-spin" />
              Carregando configurações...
            </div>
          )}

          {!loading && !canEdit && (
            <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2.5">
              <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">
                Somente administradores podem alterar estas configurações.
              </p>
            </div>
          )}

          {!loading && form && (
            <>
              {/* ── Seção 1: SLA sem resposta ─────────────────────── */}
              <div className="space-y-4">
                <SectionHeader
                  title="SLA sem resposta"
                  enabled={form.sla.enabled}
                  canEdit={canEdit}
                  onToggle={() => setSla({ enabled: !form.sla.enabled })}
                />

                <div className="pl-1 space-y-3">
                  <NumericField
                    label="Aparece após"
                    hint="Lead sem resposta humana há mais de X horas."
                    value={form.sla.min_hours}
                    step={0.5}
                    unit="horas"
                    disabled={!canEdit || !form.sla.enabled}
                    onChange={(v) => setSla({ min_hours: v })}
                  />
                  <NumericField
                    label="Crítico após"
                    hint="Lead marcado como crítico após X horas. Deve ser maior que o valor acima."
                    value={form.sla.critical_hours}
                    step={0.5}
                    unit="horas"
                    disabled={!canEdit || !form.sla.enabled}
                    onChange={(v) => setSla({ critical_hours: v })}
                  />
                  <NumericField
                    label="Máximo de alertas exibidos"
                    value={form.sla.limit}
                    step={1}
                    unit="alertas"
                    disabled={!canEdit || !form.sla.enabled}
                    onChange={(v) => setSla({ limit: Math.round(v) })}
                  />
                </div>

                {validationErrors.sla && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle size={12} className="flex-shrink-0" />
                    {validationErrors.sla}
                  </div>
                )}
              </div>

              <hr className="border-gray-100" />

              {/* ── Seção 2: Oportunidade parada ──────────────────── */}
              <div className="space-y-4">
                <SectionHeader
                  title="Oportunidade parada"
                  enabled={form.stalled.enabled}
                  canEdit={canEdit}
                  onToggle={() => setStalled({ enabled: !form.stalled.enabled })}
                />

                <div className="pl-1 space-y-3">
                  <NumericField
                    label="Parada há mais de"
                    hint="Oportunidade sem interação há mais de X dias."
                    value={form.stalled.idle_days}
                    step={1}
                    unit="dias"
                    disabled={!canEdit || !form.stalled.enabled}
                    onChange={(v) => setStalled({ idle_days: v })}
                  />
                  <NumericField
                    label="Probabilidade mínima"
                    hint="Considera apenas oportunidades com probabilidade ≥ X%."
                    value={form.stalled.min_probability}
                    step={1}
                    unit="%"
                    disabled={!canEdit || !form.stalled.enabled}
                    onChange={(v) => setStalled({ min_probability: Math.round(v) })}
                  />
                  <NumericField
                    label="Máximo de alertas exibidos"
                    value={form.stalled.limit}
                    step={1}
                    unit="alertas"
                    disabled={!canEdit || !form.stalled.enabled}
                    onChange={(v) => setStalled({ limit: Math.round(v) })}
                  />
                </div>

                {validationErrors.stalled && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle size={12} className="flex-shrink-0" />
                    {validationErrors.stalled}
                  </div>
                )}
              </div>

              <hr className="border-gray-100" />

              {/* ── Seção 3: Risco de vendedor ─────────────────────── */}
              <div className="space-y-4">
                <SectionHeader
                  title="Risco de vendedor"
                  enabled={form.sellerRisk.enabled}
                  canEdit={canEdit}
                  onToggle={() => setSellerRisk({ enabled: !form.sellerRisk.enabled })}
                />

                <div className="pl-1 space-y-3">
                  <NumericField
                    label="Leads aguardando há mais de"
                    hint="Vendedor alerta quando tem leads sem resposta há mais de X horas."
                    value={form.sellerRisk.waiting_hours}
                    step={0.5}
                    unit="horas"
                    disabled={!canEdit || !form.sellerRisk.enabled}
                    onChange={(v) => setSellerRisk({ waiting_hours: v })}
                  />
                  <NumericField
                    label="Mínimo de leads pendentes"
                    hint="Alerta quando o vendedor tem pelo menos X leads nessa situação."
                    value={form.sellerRisk.min_leads}
                    step={1}
                    unit="leads"
                    disabled={!canEdit || !form.sellerRisk.enabled}
                    onChange={(v) => setSellerRisk({ min_leads: Math.round(v) })}
                  />
                  <NumericField
                    label="Máximo de vendedores exibidos"
                    value={form.sellerRisk.limit}
                    step={1}
                    unit="vendedores"
                    disabled={!canEdit || !form.sellerRisk.enabled}
                    onChange={(v) => setSellerRisk({ limit: Math.round(v) })}
                  />
                </div>

                {validationErrors.sellerRisk && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle size={12} className="flex-shrink-0" />
                    {validationErrors.sellerRisk}
                  </div>
                )}
              </div>

              <hr className="border-gray-100" />

              {/* ── Seção 4: Escopo para Oportunidades Paradas ────── */}
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">Escopo para Oportunidades Paradas</h3>
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    Este filtro afeta apenas alertas de oportunidades paradas. SLA sem resposta e risco por
                    vendedor continuam usando suas próprias regras.
                  </p>
                </div>

                {/* Toggle Todos / Personalizado */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      setFunnelScope({ mode: 'all', stage_ids: [] })
                    }}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:cursor-not-allowed ${
                      form.funnelScope.mode === 'all'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400'
                    }`}
                  >
                    Todos os funis
                  </button>
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      setFunnelScope({ mode: 'custom' })
                      void loadFunnels()
                    }}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:cursor-not-allowed ${
                      form.funnelScope.mode === 'custom'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-400'
                    }`}
                  >
                    Personalizado
                  </button>
                </div>

                {/* Picker de funis/etapas — modo custom */}
                {form.funnelScope.mode === 'custom' && (
                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    {loadingFunnels && (
                      <div className="flex items-center justify-center py-4 gap-2 text-sm text-gray-400">
                        <Loader2 size={14} className="animate-spin" />
                        Carregando funis...
                      </div>
                    )}

                    {!loadingFunnels && funnels.length === 0 && (
                      <p className="text-xs text-gray-500 text-center py-4">
                        Nenhum funil encontrado para esta empresa.
                      </p>
                    )}

                    {!loadingFunnels && funnels.map((funnel) => {
                      const stages       = stagesByFunnel[funnel.id] ?? []
                      const isExpanded   = expandedFunnel === funnel.id
                      const selectedInFunnel = stages.filter(s => form.funnelScope.stage_ids.includes(s.id)).length
                      const allSelected  = stages.length > 0 && selectedInFunnel === stages.length

                      return (
                        <div key={funnel.id} className="border-b border-gray-100 last:border-b-0">
                          {/* Header do funil */}
                          <button
                            type="button"
                            disabled={!canEdit}
                            className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 disabled:cursor-not-allowed transition-colors"
                            onClick={() => {
                              const next = isExpanded ? null : funnel.id
                              setExpandedFunnel(next)
                              if (next) void loadStagesForFunnel(funnel.id)
                            }}
                          >
                            <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                              {funnel.name}
                              {selectedInFunnel > 0 && (
                                <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-medium">
                                  {selectedInFunnel}/{stages.length > 0 ? stages.length : '…'}
                                </span>
                              )}
                            </span>
                            {isExpanded
                              ? <ChevronUp size={14} className="text-gray-400" />
                              : <ChevronDown size={14} className="text-gray-400" />
                            }
                          </button>

                          {/* Etapas do funil */}
                          {isExpanded && (
                            <div className="bg-gray-50 px-3 pb-2 pt-1 space-y-1">
                              {stages.length === 0 && (
                                <p className="text-xs text-gray-400 py-1">Sem etapas cadastradas.</p>
                              )}

                              {stages.length > 0 && (
                                <div className="flex items-center justify-between py-1 mb-1">
                                  <span className="text-xs text-gray-500">{stages.length} etapa(s)</span>
                                  <button
                                    type="button"
                                    disabled={!canEdit}
                                    onClick={() => handleToggleFunnelAll(funnel.id, stages)}
                                    className="text-xs text-indigo-600 hover:text-indigo-800 disabled:cursor-not-allowed"
                                  >
                                    {allSelected ? 'Limpar funil' : 'Selecionar tudo'}
                                  </button>
                                </div>
                              )}

                              {stages.map((stage) => {
                                const checked = form.funnelScope.stage_ids.includes(stage.id)
                                return (
                                  <label
                                    key={stage.id}
                                    className={`flex items-center gap-2 py-1 cursor-pointer group ${!canEdit ? 'cursor-not-allowed opacity-60' : ''}`}
                                  >
                                    <input
                                      type="checkbox"
                                      disabled={!canEdit}
                                      checked={checked}
                                      onChange={() => handleToggleStage(stage.id)}
                                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                                    />
                                    <span className="flex items-center gap-1.5 text-sm text-gray-700">
                                      {stage.color && (
                                        <span
                                          className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                                          style={{ backgroundColor: stage.color }}
                                        />
                                      )}
                                      {stage.name}
                                    </span>
                                  </label>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {validationErrors.funnelScope && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle size={12} className="flex-shrink-0" />
                    {validationErrors.funnelScope}
                  </div>
                )}
              </div>

              {/* Sem alterações */}
              {!hasChanges && originalForm && (
                <div className="flex items-center gap-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">
                  <CheckCircle2 size={13} className="text-gray-400 flex-shrink-0" />
                  Nenhuma alteração em relação às configurações atuais.
                </div>
              )}

              {/* Erro de rede */}
              {error && (
                <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Rodapé */}
        {!loading && form && (
          <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
            {canEdit ? (
              <button
                type="button"
                onClick={handleReset}
                className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                Restaurar padrões
              </button>
            ) : (
              <span />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-md text-sm text-gray-600 border border-gray-200 hover:bg-gray-100 transition-colors"
              >
                {canEdit ? 'Cancelar' : 'Fechar'}
              </button>

              {canEdit && (
                <button
                  type="button"
                  onClick={handleRequestSave}
                  disabled={!hasChanges || !isValid}
                  title={
                    !hasChanges
                      ? 'Nenhuma alteração para salvar'
                      : !isValid
                      ? 'Corrija os erros antes de salvar'
                      : undefined
                  }
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Save size={14} />
                  Salvar configurações
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
