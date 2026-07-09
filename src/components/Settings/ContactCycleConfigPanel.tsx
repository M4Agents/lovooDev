// =====================================================
// ContactCycleConfigPanel
//
// Painel de configuração geral do Motor de Ciclos de Contato.
// Consumido por ContactCycleSection (E10) — não importar em outros arquivos ainda.
//
// Props:
//   companyId          — empresa ativa
//   canManage          — true = admin+ (edita); false = seller (somente leitura)
// =====================================================

import React, { useState, useEffect } from 'react'
import { Settings2, Save, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useContactCycleConfig } from '../../hooks/useContactCycleConfig'
import type { ContactCycleConfigForm, EligibilityRule } from '../../types/contact-cycles'

interface Props {
  companyId: string
  canManage: boolean
}

const ELIGIBILITY_OPTIONS: Array<{ value: EligibilityRule; label: string; hint: string }> = [
  {
    value: 'hours',
    label: 'Intervalo em horas',
    hint: 'Após o fechamento de um ciclo (por qualquer motivo, inclusive quando o lead responde), um novo ciclo de tentativas só poderá ser aberto após o intervalo definido. O envio de mensagens pelo WhatsApp continua funcionando normalmente durante esse período.',
  },
  {
    value: 'day_change',
    label: 'Virada de dia',
    hint: 'Novo ciclo permitido a partir do dia seguinte ao fechamento.',
  },
  {
    value: 'both',
    label: 'Intervalo em horas + virada de dia',
    hint: 'Ambas as condições devem ser satisfeitas.',
  },
]

export const ContactCycleConfigPanel: React.FC<Props> = ({ companyId, canManage }) => {
  const { config, loading, saving, error, refresh, update } = useContactCycleConfig(companyId)

  // ── Form local (espelha config carregada) ─────────────────────
  const [form, setForm] = useState<ContactCycleConfigForm>({
    enabled: false,
    eligibility_rule: 'hours',
    eligibility_hours: 24,
    show_extra_questions: false,
  })
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Sincronizar form com config carregada
  useEffect(() => {
    if (config) {
      setForm({
        enabled:              config.enabled,
        eligibility_rule:     config.eligibility_rule,
        eligibility_hours:    config.eligibility_hours,
        show_extra_questions: config.show_extra_questions,
      })
    }
  }, [config])

  const needsHours = form.eligibility_rule === 'hours' || form.eligibility_rule === 'both'

  // hasChanges: detecta diff entre form local e config do servidor
  const hasChanges = config !== null && (
    form.enabled              !== config.enabled              ||
    form.eligibility_rule     !== config.eligibility_rule     ||
    form.show_extra_questions !== config.show_extra_questions ||
    (needsHours
      ? form.eligibility_hours !== config.eligibility_hours
      : config.eligibility_hours !== null)
  )

  const flash = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleSave = async () => {
    setFormError(null)
    const ok = await update(form)
    if (ok) flash()
    else setFormError(error)
  }

  // ── Render ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Carregando configuração...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Cabeçalho */}
      <div>
        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-indigo-500" />
          Configuração geral
        </h4>
        <p className="text-xs text-slate-500 mt-1">
          Defina como o módulo de ciclos de contato se comporta nesta empresa.
        </p>
        {!canManage && (
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
            Você tem permissão apenas para visualizar esta configuração.
          </p>
        )}
      </div>

      {/* Erros do hook */}
      {(formError ?? error) && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {formError ?? error}
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Configuração salva com sucesso.
        </div>
      )}

      {/* Campos */}
      <div className="space-y-5">

        {/* enabled */}
        <div className="flex items-center justify-between py-3 border-b border-slate-100">
          <div>
            <p className="text-sm font-medium text-slate-800">Módulo ativo</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Quando desativado, nenhum ciclo é aberto ou registrado.
            </p>
          </div>
          <button
            type="button"
            disabled={!canManage}
            onClick={() => canManage && setForm(f => ({ ...f, enabled: !f.enabled }))}
            aria-pressed={form.enabled}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              form.enabled ? 'bg-indigo-600' : 'bg-slate-200'
            } ${!canManage ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                form.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* eligibility_rule */}
        <div className="space-y-1">
          <label className="block text-xs font-semibold text-slate-600">
            Regra de elegibilidade para novo ciclo
          </label>
          <select
            value={form.eligibility_rule}
            disabled={!canManage}
            onChange={e => setForm(f => ({
              ...f,
              eligibility_rule: e.target.value as EligibilityRule,
              // Limpar horas ao mudar para day_change
              eligibility_hours: e.target.value === 'day_change' ? null : f.eligibility_hours,
            }))}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:bg-slate-50"
          >
            {ELIGIBILITY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            {ELIGIBILITY_OPTIONS.find(o => o.value === form.eligibility_rule)?.hint}
          </p>
        </div>

        {/* eligibility_hours — condicional */}
        {needsHours && (
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-slate-600">
              Intervalo mínimo (horas) *
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={form.eligibility_hours ?? ''}
              disabled={!canManage}
              onChange={e => {
                const val = parseInt(e.target.value, 10)
                setForm(f => ({ ...f, eligibility_hours: isNaN(val) ? null : val }))
              }}
              placeholder="Ex: 24"
              className="w-32 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50 disabled:bg-slate-50"
            />
            <p className="text-xs text-slate-500">
              Mínimo: 1 hora. Ex: <strong>4h</strong> = após o fechamento do ciclo (inclusive quando o lead responder), o vendedor só poderá abrir um novo ciclo de tentativas depois de 4h. Durante esse período, o envio de mensagens pelo WhatsApp continua funcionando normalmente.
            </p>
          </div>
        )}

        {/* show_extra_questions */}
        <div className="flex items-center justify-between py-3 border-b border-slate-100">
          <div>
            <p className="text-sm font-medium text-slate-800">Exibir perguntas adicionais</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Quando ativo, o modal de tentativa exibe as perguntas configuradas.
            </p>
          </div>
          <button
            type="button"
            disabled={!canManage}
            onClick={() => canManage && setForm(f => ({ ...f, show_extra_questions: !f.show_extra_questions }))}
            aria-pressed={form.show_extra_questions}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
              form.show_extra_questions ? 'bg-indigo-600' : 'bg-slate-200'
            } ${!canManage ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                form.show_extra_questions ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

      </div>

      {/* Botão salvar — apenas admin+ */}
      {canManage && (
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          {hasChanges && !saving && (
            <button
              onClick={() => { refresh(); setFormError(null) }}
              className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              Descartar alterações
            </button>
          )}
        </div>
      )}
    </div>
  )
}
