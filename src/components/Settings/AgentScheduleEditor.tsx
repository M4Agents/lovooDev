import { useState } from 'react'
import { ChevronDown, ChevronUp, Clock } from 'lucide-react'
import type { OperatingSchedule, ScheduleWindow } from '../../services/companyAgentConfigApi'

// ── Constantes ────────────────────────────────────────────────────────────────

const DAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']

const TIMEZONES = [
  { value: 'America/Sao_Paulo',   label: 'Brasília (UTC-3)' },
  { value: 'America/Manaus',      label: 'Manaus (UTC-4)' },
  { value: 'America/Belem',       label: 'Belém (UTC-3)' },
  { value: 'America/Fortaleza',   label: 'Fortaleza (UTC-3)' },
  { value: 'America/Recife',      label: 'Recife (UTC-3)' },
  { value: 'America/Maceio',      label: 'Maceió (UTC-3)' },
  { value: 'America/Bahia',       label: 'Salvador (UTC-3)' },
  { value: 'America/Cuiaba',      label: 'Cuiabá (UTC-4)' },
  { value: 'America/Porto_Velho', label: 'Porto Velho (UTC-4)' },
  { value: 'America/Rio_Branco',  label: 'Rio Branco (UTC-5)' },
  { value: 'America/Noronha',     label: 'Fernando de Noronha (UTC-2)' },
  { value: 'UTC',                 label: 'UTC (UTC+0)' },
  { value: 'America/New_York',    label: 'New York (UTC-5)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (UTC-8)' },
  { value: 'Europe/Lisbon',       label: 'Lisboa (UTC+0)' },
  { value: 'Europe/London',       label: 'Londres (UTC+0)' },
]

const DEFAULT_SCHEDULE: OperatingSchedule = {
  enabled:  true,
  timezone: 'America/Sao_Paulo',
  windows:  [],
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  value:     OperatingSchedule | null
  onChange:  (v: OperatingSchedule | null) => void
  readOnly?: boolean
}

// ── Componente ────────────────────────────────────────────────────────────────

export function AgentScheduleEditor({ value, onChange, readOnly = false }: Props) {
  const [expanded, setExpanded] = useState(false)

  const schedule = value ?? null
  const enabled  = schedule?.enabled ?? false

  function handleToggle() {
    if (readOnly) return
    if (!enabled) {
      onChange({ ...(schedule ?? DEFAULT_SCHEDULE), enabled: true })
    } else {
      onChange(null)
    }
  }

  function handleTimezone(tz: string) {
    if (readOnly || !schedule) return
    onChange({ ...schedule, timezone: tz })
  }

  function windowsForDay(day: number): ScheduleWindow[] {
    return (schedule?.windows ?? []).filter((w) => w.day === day)
  }

  function addWindow(day: number) {
    if (readOnly || !schedule) return
    const existing = windowsForDay(day)
    const lastEnd  = existing.length > 0 ? existing[existing.length - 1].end : '08:00'
    const newWindow: ScheduleWindow = { day, start: lastEnd, end: '18:00' }
    onChange({ ...schedule, windows: [...schedule.windows, newWindow] })
  }

  function updateWindow(day: number, index: number, field: 'start' | 'end', val: string) {
    if (readOnly || !schedule) return
    const allWindows = [...schedule.windows]
    const dayWindows = allWindows
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.day === day)

    if (!dayWindows[index]) return
    const globalIdx = dayWindows[index].i
    allWindows[globalIdx] = { ...allWindows[globalIdx], [field]: val }
    onChange({ ...schedule, windows: allWindows })
  }

  function removeWindow(day: number, index: number) {
    if (readOnly || !schedule) return
    const dayWindows = schedule.windows
      .map((w, i) => ({ w, i }))
      .filter(({ w }) => w.day === day)

    if (!dayWindows[index]) return
    const globalIdx = dayWindows[index].i
    const allWindows = schedule.windows.filter((_, i) => i !== globalIdx)
    onChange({ ...schedule, windows: allWindows })
  }

  function toggleDay(day: number) {
    if (readOnly || !schedule) return
    const hasWindows = windowsForDay(day).length > 0
    if (hasWindows) {
      onChange({ ...schedule, windows: schedule.windows.filter((w) => w.day !== day) })
    } else {
      addWindow(day)
    }
  }

  function hasOverlap(day: number): boolean {
    const ws = windowsForDay(day).slice().sort((a, b) => (a.start < b.start ? -1 : 1))
    for (let i = 0; i < ws.length - 1; i++) {
      if (ws[i].start < ws[i + 1].end && ws[i + 1].start < ws[i].end) return true
    }
    return false
  }

  // ── Resumo do estado para exibição quando colapsado ──────────────────────

  function summaryLabel(): string {
    if (!enabled) return 'Atendimento 24h (sem restrição)'
    const total = schedule?.windows?.length ?? 0
    if (total === 0) return 'Restrição ativa — nenhuma janela configurada (IA bloqueada)'
    const days = [...new Set(schedule!.windows.map((w) => w.day))].sort()
    return `Agendamento ativo — ${days.length} dia(s), ${total} janela(s)`
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">

      {/* Header clicável */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-gray-800">
              Horário de atendimento deste agente nesta empresa
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{summaryLabel()}</p>
          </div>
        </div>
        {expanded
          ? <ChevronUp   className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        }
      </button>

      {/* Corpo expandido */}
      {expanded && (
        <div className="px-4 py-4 space-y-4 bg-white">

          {/* Descrição */}
          <p className="text-xs text-gray-500">
            Define quando este agente de IA pode responder leads nesta empresa.
            Fora dos horários configurados, a IA permanece ativa, mas não responde automaticamente.
          </p>

          {/* Toggle de restrição */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              role="checkbox"
              aria-checked={enabled}
              onClick={handleToggle}
              className={`relative w-10 h-6 rounded-full transition-colors ${
                readOnly ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
              } ${enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </div>
            <span className="text-sm font-medium text-gray-700">
              {enabled ? 'Restrição de horário ativa' : 'Sem restrição (atendimento 24h)'}
            </span>
          </label>

          {/* Aviso de schedule vazio */}
          {enabled && (schedule?.windows?.length ?? 0) === 0 && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Nenhuma janela configurada. Com a restrição ativa e sem janelas, a IA <strong>nunca responderá</strong>.
              Adicione ao menos um horário para ativar o atendimento.
            </p>
          )}

          {/* Seletor de timezone */}
          {enabled && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Fuso horário</label>
              <div className="relative">
                <select
                  value={schedule?.timezone ?? 'America/Sao_Paulo'}
                  onChange={(e) => handleTimezone(e.target.value)}
                  disabled={readOnly}
                  className="w-full appearance-none bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          )}

          {/* Grid de dias */}
          {enabled && (
            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-600">Janelas de atendimento por dia</p>

              {DAY_LABELS.map((label, day) => {
                const dayWindows = windowsForDay(day)
                const active     = dayWindows.length > 0
                const overlap    = hasOverlap(day)

                return (
                  <div key={day} className="rounded-lg border border-gray-200 overflow-hidden">
                    {/* Cabeçalho do dia */}
                    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50">
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleDay(day)}
                        disabled={readOnly}
                        className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed"
                      />
                      <span className="text-sm font-medium text-gray-700 w-8">{label}</span>
                      {active && !readOnly && (
                        <button
                          type="button"
                          onClick={() => addWindow(day)}
                          className="ml-auto text-xs text-blue-600 hover:text-blue-700 font-medium"
                        >
                          + janela
                        </button>
                      )}
                    </div>

                    {/* Janelas do dia */}
                    {active && (
                      <div className="px-3 py-2 space-y-2">
                        {dayWindows.map((w, idx) => {
                          const startGtEnd = w.start >= w.end
                          return (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-8">de</span>
                              <input
                                type="time"
                                value={w.start}
                                onChange={(e) => updateWindow(day, idx, 'start', e.target.value)}
                                disabled={readOnly}
                                className={`border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed ${
                                  startGtEnd ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                                }`}
                              />
                              <span className="text-xs text-gray-500">até</span>
                              <input
                                type="time"
                                value={w.end}
                                onChange={(e) => updateWindow(day, idx, 'end', e.target.value)}
                                disabled={readOnly}
                                className={`border rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed ${
                                  startGtEnd ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                                }`}
                              />
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() => removeWindow(day, idx)}
                                  className="text-xs text-red-400 hover:text-red-600 ml-1"
                                  title="Remover janela"
                                >
                                  ✕
                                </button>
                              )}
                              {startGtEnd && (
                                <span className="text-xs text-red-500">início deve ser anterior ao fim</span>
                              )}
                            </div>
                          )
                        })}

                        {overlap && (
                          <p className="text-xs text-red-500">
                            Janelas sobrepostas detectadas. O backend rejeitará o salvamento.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Badge somente leitura */}
          {readOnly && (
            <p className="text-xs text-gray-400 text-center">
              Somente leitura — você não tem permissão para editar o horário de atendimento.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
