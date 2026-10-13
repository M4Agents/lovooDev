import { useEffect, useState } from 'react'
import { PeriodFilter } from '../../PeriodFilter'
import { fetchTasklessConfig, saveTasklessConfig, type TasklessFunnel } from '../../../services/tasklessLeadsApi'
import { PREDEFINED_PERIODS, type PeriodFilter as PeriodFilterValue } from '../../../types/analytics'
import { DEFAULT_TASKLESS_PERIOD, type TasklessPeriodType } from '../../../utils/tasklessPeriod'

interface Props {
  companyId: string
  onClose: () => void
  onSaved: () => void
}

function defaultPeriod(): PeriodFilterValue {
  return { ...PREDEFINED_PERIODS[DEFAULT_TASKLESS_PERIOD] }
}

function civilFromDate(date: Date | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function periodFromConfig(type: string, start: string | null, end: string | null): PeriodFilterValue {
  const preset = PREDEFINED_PERIODS[type as keyof typeof PREDEFINED_PERIODS] ?? PREDEFINED_PERIODS[DEFAULT_TASKLESS_PERIOD]
  if (type !== 'custom' || !start || !end) return { ...preset }
  const [sy, sm, sd] = start.split('-').map(Number)
  const [ey, em, ed] = end.split('-').map(Number)
  return {
    ...preset,
    startDate: new Date(sy, sm - 1, sd),
    endDate: new Date(ey, em - 1, ed, 23, 59, 59),
  }
}

export function TasklessConfigPanel({ companyId, onClose, onSaved }: Props) {
  const [funnels, setFunnels] = useState<TasklessFunnel[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [period, setPeriod] = useState<PeriodFilterValue>(defaultPeriod)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchTasklessConfig(companyId)
      .then(config => {
        if (cancelled) return
        setFunnels(config.funnels)
        setSelected(new Set(config.stage_ids))
        setPeriod(periodFromConfig(config.period_type, config.custom_start, config.custom_end))
        setReady(true)
        setError(null)
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Erro ao carregar a configuração')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [companyId])

  const toggle = (stageId: string) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })
  }

  const save = async () => {
    const periodType = period.type
    if (periodType === 'all' || !(periodType in PREDEFINED_PERIODS)) {
      setError('Período inválido')
      return
    }
    let customStart: string | null = null
    let customEnd: string | null = null
    if (periodType === 'custom') {
      customStart = civilFromDate(period.startDate)
      customEnd = civilFromDate(period.endDate)
      if (!customStart || !customEnd || customStart > customEnd) {
        setError('Informe a data de início e a data de término')
        return
      }
    }

    setSaving(true)
    setError(null)
    try {
      await saveTasklessConfig(companyId, [...selected], {
        periodType: periodType as TasklessPeriodType,
        customStart,
        customEnd,
      })
      onSaved()
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao salvar a configuração')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Configurações</h2>
          <p className="mt-1 text-sm text-gray-500">
            Leads que entraram nas etapas marcadas neste período e não têm tarefa pendente. Esta escolha vale só para você.
          </p>
        </div>
        <div className="border-b border-gray-100 px-5 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Período</p>
          <PeriodFilter selectedPeriod={period} onPeriodChange={setPeriod} />
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-gray-500">Carregando funis...</p>}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!loading && funnels.length === 0 && (
            <p className="text-sm text-gray-500">Esta empresa não tem funis de vendas.</p>
          )}
          {funnels.map(funnel => (
            <fieldset key={funnel.id} className="space-y-2">
              <legend className="text-sm font-medium text-gray-800">
                {funnel.name}{funnel.is_active ? '' : ' (inativo)'}
              </legend>
              {funnel.stages.map(stage => (
                <label key={stage.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={selected.has(stage.id)}
                    disabled={saving}
                    onChange={() => toggle(stage.id)}
                  />
                  <span>{stage.name}</span>
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Fechar
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || !ready}
            className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
