// =====================================================
// InsightRulesModal
// Modal de configuração de thresholds dos insights.
//
// Fluxo de salvamento em 2 etapas:
//   1. 'editing'    — usuário edita os campos
//   2. 'confirming' — exibe resumo das alterações antes de salvar
//
// Proteções de UX:
//   - Botão "Salvar regras" desabilitado se não houver alterações
//   - Primeiro clique mostra diff, não salva imediatamente
//   - Confirmação explícita obrigatória antes de chamar save()
// =====================================================

import React, { useState, useEffect, useMemo } from 'react'
import { X, Save, Loader2, AlertCircle, CheckCircle2, RotateCcw, Info, ArrowRight, ChevronLeft } from 'lucide-react'
import { useInsightPolicies }       from '../../../hooks/dashboard/useInsightPolicies'
import type { InsightPoliciesData } from '../../../services/dashboardApi'

// ---------------------------------------------------------------------------
// Tipos e constantes
// ---------------------------------------------------------------------------

interface InsightRulesModalProps {
  isOpen:    boolean
  onClose:   () => void
  onSaved:   () => void
  companyId: string | null
}

type ModalStep = 'editing' | 'confirming'

const COOLING_PRESETS = [1, 2, 3, 7]
const DEFAULT_COOLING = 3

const FIELD_META: Record<keyof InsightPoliciesData, { label: string; unit: 'days' | 'percent' }> = {
  cooling_threshold_days:    { label: 'Leads esfriando',    unit: 'days'    },
  hot_probability_threshold: { label: 'Oportunidade quente', unit: 'percent' },
  conversion_drop_threshold: { label: 'Queda de conversão', unit: 'percent' },
  bottleneck_min_days:       { label: 'Gargalo no funil',   unit: 'days'    },
  ai_error_rate_threshold:   { label: 'Falha da IA',        unit: 'percent' },
}

function formatValue(value: number, unit: 'days' | 'percent'): string {
  if (unit === 'days') return `${value} ${value === 1 ? 'dia' : 'dias'}`
  return `${value}%`
}

// ---------------------------------------------------------------------------
// DiffItem — representa uma alteração entre original e form atual
// ---------------------------------------------------------------------------

interface DiffItem {
  key:   keyof InsightPoliciesData
  label: string
  from:  number
  to:    number
  unit:  'days' | 'percent'
}

function computeDiff(original: InsightPoliciesData, current: InsightPoliciesData): DiffItem[] {
  return (Object.keys(FIELD_META) as (keyof InsightPoliciesData)[])
    .filter((key) => original[key] !== current[key])
    .map((key) => ({
      key,
      label: FIELD_META[key].label,
      from:  original[key],
      to:    current[key],
      unit:  FIELD_META[key].unit,
    }))
}

// ---------------------------------------------------------------------------
// NumberField — campo numérico reutilizável
// ---------------------------------------------------------------------------

interface NumberFieldProps {
  label:      string
  hint:       string
  value:      number
  min:        number
  max:        number
  unit:       'days' | 'percent'
  defaultVal: number
  onChange:   (v: number) => void
}

function NumberField({ label, hint, value, min, max, unit, defaultVal, onChange }: NumberFieldProps) {
  const unitLabel = unit === 'days' ? (value === 1 ? ' dia' : ' dias') : '%'
  const defaultLabel = formatValue(defaultVal, unit)
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        <span className="text-xs text-gray-400">padrão: {defaultLabel}</span>
      </div>
      <p className="text-xs text-gray-500 mb-1.5">{hint}</p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
          }}
          className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <span className="text-sm text-gray-500">{unitLabel}</span>
        <span className="text-xs text-gray-400 ml-1">(min {min} / máx {max})</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InsightRulesModal
// ---------------------------------------------------------------------------

export const InsightRulesModal: React.FC<InsightRulesModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  companyId,
}) => {
  const { policies, defaults, loading, saving, error, save, reset } = useInsightPolicies(
    isOpen ? companyId : null,
  )

  const [form,              setForm]              = useState<InsightPoliciesData | null>(null)
  const [originalPolicies,  setOriginalPolicies]  = useState<InsightPoliciesData | null>(null)
  const [coolingCustom,     setCoolingCustom]     = useState(false)
  const [step,              setStep]              = useState<ModalStep>('editing')
  const [saved,             setSaved]             = useState(false)

  // Reinicia estados ao abrir/fechar
  useEffect(() => {
    if (isOpen) {
      setStep('editing')
      setSaved(false)
      setOriginalPolicies(null)
    }
  }, [isOpen])

  // Sincroniza form com policies carregadas — captura snapshot original
  useEffect(() => {
    if (policies && !originalPolicies) {
      setOriginalPolicies({ ...policies })
      setForm({ ...policies })
      setCoolingCustom(!COOLING_PRESETS.includes(policies.cooling_threshold_days))
    }
  }, [policies, originalPolicies])

  // useMemo deve ficar ANTES de qualquer early return (Rules of Hooks)
  const diff: DiffItem[] = useMemo(
    () => (originalPolicies && form ? computeDiff(originalPolicies, form) : []),
    [originalPolicies, form],
  )

  const hasChanges = diff.length > 0

  if (!isOpen) return null

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function setField<K extends keyof InsightPoliciesData>(key: K, value: number) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  function handleRequestSave() {
    if (!form || !hasChanges) return
    setStep('confirming')
  }

  async function handleConfirmSave() {
    if (!form) return
    const ok = await save(form)
    if (ok) {
      setSaved(true)
      setTimeout(() => {
        onSaved()
        onClose()
      }, 900)
    }
  }

  function handleReset() {
    reset()
    if (defaults) {
      setForm({ ...defaults })
      setOriginalPolicies({ ...defaults })
      setCoolingCustom(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render — Confirmação
  // ---------------------------------------------------------------------------

  if (step === 'confirming') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

        <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 flex flex-col">
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

          {/* Corpo — diff */}
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-700 font-medium">Você está prestes a alterar:</p>

            <ul className="space-y-2">
              {diff.map((item) => (
                <li key={item.key} className="flex items-center gap-2 text-sm">
                  <span className="w-40 text-gray-600 truncate">{item.label}:</span>
                  <span className="text-gray-500 line-through">{formatValue(item.from, item.unit)}</span>
                  <ArrowRight size={13} className="text-gray-400 flex-shrink-0" />
                  <span className="font-semibold text-gray-900">{formatValue(item.to, item.unit)}</span>
                </li>
              ))}
            </ul>

            {/* Aviso de impacto */}
            <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 mt-4">
              <Info size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">
                Após salvar, os insights serão recalculados com base nas novas regras.
              </p>
            </div>

            {/* Erro */}
            {error && !saving && (
              <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                <AlertCircle size={14} className="flex-shrink-0" />
                {error}
              </div>
            )}

            {/* Sucesso */}
            {saved && (
              <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-700">
                <CheckCircle2 size={14} className="flex-shrink-0" />
                Regras salvas com sucesso!
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
              disabled={saving || saved}
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
  // Render — Edição
  // ---------------------------------------------------------------------------

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />

      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">

        {/* Cabeçalho */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Configurar regras de insights</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Essas regras afetam os insights exibidos no Dashboard da empresa.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Aviso de impacto — sempre visível */}
          {!loading && form && (
            <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2.5">
              <Info size={14} className="text-blue-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-blue-700 font-medium">
                  Essas alterações impactam diretamente os insights exibidos no Dashboard da empresa.
                </p>
                <p className="text-xs text-blue-600 mt-0.5">
                  Após salvar, os insights serão recalculados com base nas novas regras.
                </p>
              </div>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400 gap-2 text-sm">
              <Loader2 size={18} className="animate-spin" />
              Carregando regras...
            </div>
          )}

          {/* Formulário */}
          {!loading && form && (
            <>
              {/* Campo 1 — Leads esfriando */}
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="text-sm font-medium text-gray-700">Leads esfriando após</label>
                  <span className="text-xs text-gray-400">padrão: {DEFAULT_COOLING} dias</span>
                </div>
                <p className="text-xs text-gray-500 mb-2">
                  Oportunidades sem interação há mais de X dias são marcadas como esfriando.
                </p>

                <div className="flex gap-2 flex-wrap">
                  {COOLING_PRESETS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { setField('cooling_threshold_days', d); setCoolingCustom(false) }}
                      className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                        !coolingCustom && form.cooling_threshold_days === d
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      {d} {d === 1 ? 'dia' : 'dias'}
                      {d === DEFAULT_COOLING && <span className="ml-1 text-xs opacity-70">(rec.)</span>}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCoolingCustom(true)}
                    className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                      coolingCustom
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                    }`}
                  >
                    Personalizado
                  </button>
                </div>

                {coolingCustom && (
                  <div className="flex items-center gap-2 mt-2">
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={form.cooling_threshold_days}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10)
                        if (!Number.isNaN(n)) setField('cooling_threshold_days', Math.min(30, Math.max(1, n)))
                      }}
                      className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-sm text-gray-500">dias (1–30)</span>
                  </div>
                )}
              </div>

              <hr className="border-gray-100" />

              <NumberField
                label="Oportunidade quente a partir de"
                hint="Oportunidades com probabilidade de fechamento igual ou acima desse valor são destacadas como quentes."
                value={form.hot_probability_threshold}
                min={50} max={95} unit="percent" defaultVal={70}
                onChange={(v) => setField('hot_probability_threshold', v)}
              />

              <hr className="border-gray-100" />

              <NumberField
                label="Queda de conversão abaixo de"
                hint="Se a taxa de conversão do funil cair abaixo desse percentual no período, o insight é ativado."
                value={form.conversion_drop_threshold}
                min={10} max={80} unit="percent" defaultVal={40}
                onChange={(v) => setField('conversion_drop_threshold', v)}
              />

              <hr className="border-gray-100" />

              <NumberField
                label="Gargalo no funil: etapa parada há mais de"
                hint="Etapas onde oportunidades ficam paradas em média por mais de X dias são consideradas gargalos."
                value={form.bottleneck_min_days}
                min={1} max={30} unit="days" defaultVal={3}
                onChange={(v) => setField('bottleneck_min_days', v)}
              />

              <hr className="border-gray-100" />

              <NumberField
                label="Alerta de falha da IA acima de"
                hint="Se a taxa de erros das execuções da IA ultrapassar esse percentual, o insight é ativado."
                value={form.ai_error_rate_threshold}
                min={5} max={80} unit="percent" defaultVal={20}
                onChange={(v) => setField('ai_error_rate_threshold', v)}
              />
            </>
          )}

          {/* Sem alterações */}
          {!loading && form && !hasChanges && originalPolicies && (
            <div className="flex items-center gap-2 rounded-md bg-gray-50 border border-gray-200 px-3 py-2 text-xs text-gray-500">
              <CheckCircle2 size={13} className="text-gray-400 flex-shrink-0" />
              Nenhuma alteração em relação às regras atuais.
            </div>
          )}

          {/* Erro */}
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={15} className="flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Rodapé */}
        {!loading && form && (
          <div className="flex items-center justify-between p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              <RotateCcw size={13} />
              Restaurar padrões
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 rounded-md text-sm text-gray-600 border border-gray-200 hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRequestSave}
                disabled={!hasChanges}
                title={!hasChanges ? 'Nenhuma alteração para salvar' : undefined}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Save size={14} />
                Salvar regras
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
