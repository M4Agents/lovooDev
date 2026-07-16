// =====================================================
// COMPONENT: DELAY FORM
// Data: 15/03/2026
// Objetivo: Formulário para atraso de tempo
// =====================================================

import { useState, useEffect } from 'react'
import { Info, AlertTriangle } from 'lucide-react'

export type WaitMode = 'time' | 'time_or_response'

/**
 * Determina o modo efetivo a partir da config armazenada.
 * wait_mode ausente ou qualquer valor desconhecido → 'time' (modo legado).
 * Exportado para testes unitários.
 */
export function resolveWaitMode(config: { wait_mode?: string | null }): WaitMode {
  return config.wait_mode === 'time_or_response' ? 'time_or_response' : 'time'
}

/**
 * Normaliza o valor do campo response_variable antes de persistir na config.
 * String com conteúdo após trim → string. Vazio / só espaços → null.
 * Exportado para testes unitários.
 */
export function normalizeResponseVariable(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

interface DelayFormProps {
  config: {
    duration?: number
    unit?: 'seconds' | 'minutes' | 'hours' | 'days'
    wait_mode?: WaitMode
    response_variable?: string | null
  }
  onChange: (config: any) => void
}

export default function DelayForm({ config, onChange }: DelayFormProps) {
  // Interpreta wait_mode ausente como 'time' (modo legado)
  const resolvedInitialMode: WaitMode =
    config.wait_mode === 'time_or_response' ? 'time_or_response' : 'time'

  const [duration, setDuration] = useState(config.duration ?? 5)
  const [unit, setUnit] = useState(config.unit || 'seconds')
  const [waitMode, setWaitMode] = useState<WaitMode>(resolvedInitialMode)
  // Campo de variável usa estado local com valor bruto (sem trim forçado durante digitação)
  const [responseVariable, setResponseVariable] = useState<string>(
    typeof config.response_variable === 'string' ? config.response_variable : ''
  )
  // Controla exibição de avisos de troca de modo
  const [modeChanged, setModeChanged] = useState(false)

  // Inicializa duration/unit se ausentes no config (comportamento legado preservado)
  // Não toca em wait_mode para não migrar flows antigos automaticamente
  useEffect(() => {
    if (config.duration === undefined || config.unit === undefined) {
      onChange({
        ...config,
        duration: duration,
        unit: unit,
      })
    }
  }, [])

  // Ao mudar o modo de espera
  const handleModeChange = (newMode: WaitMode) => {
    setWaitMode(newMode)
    setModeChanged(true)

    const updatedConfig: Record<string, any> = {
      ...config,
      wait_mode: newMode,
      // duration e unit são sempre preservados na troca
    }

    if (newMode === 'time') {
      // Voltar ao modo legado: limpar response_variable
      updatedConfig.response_variable = null
    }
    // Ao ir para time_or_response: response_variable permanece como estava

    onChange(updatedConfig)
  }

  const handleDurationChange = (value: number) => {
    setDuration(value)
    onChange({ ...config, duration: value })
  }

  const handleUnitChange = (value: string) => {
    setUnit(value)
    onChange({ ...config, unit: value })
  }

  // Normalização: string com conteúdo → string; vazio/só espaços → null
  const handleResponseVariableChange = (value: string) => {
    setResponseVariable(value)
    onChange({ ...config, response_variable: normalizeResponseVariable(value) })
  }

  const unitLabel = {
    seconds: 'segundo(s)',
    minutes: 'minuto(s)',
    hours: 'hora(s)',
    days: 'dia(s)',
  }[unit] ?? unit

  const isTimeOrResponse = waitMode === 'time_or_response'
  const showTimeWarning = modeChanged && waitMode === 'time'

  return (
    <div className="space-y-4">

      {/* ── Seletor de modo ─────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Modo de espera
        </label>
        <div className="flex flex-col gap-2">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="delay-wait-mode"
              value="time"
              checked={waitMode === 'time'}
              onChange={() => handleModeChange('time')}
              className="mt-0.5 text-orange-500 focus:ring-orange-500"
            />
            <div>
              <span className="text-sm text-gray-900 font-medium">Esperar por tempo</span>
              <p className="text-xs text-gray-500">
                O fluxo aguarda o tempo configurado e continua.
              </p>
            </div>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="radio"
              name="delay-wait-mode"
              value="time_or_response"
              checked={waitMode === 'time_or_response'}
              onChange={() => handleModeChange('time_or_response')}
              className="mt-0.5 text-orange-500 focus:ring-orange-500"
            />
            <div>
              <span className="text-sm text-gray-900 font-medium">Aguardar resposta do lead</span>
              <p className="text-xs text-gray-500">
                O fluxo aguarda uma mensagem do lead ou o tempo máximo configurado.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* ── Aviso: novo modo → dois caminhos obrigatórios ───────── */}
      {isTimeOrResponse && (
        <div className="flex items-start gap-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2.5">
          <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 leading-snug">
            Este modo possui dois caminhos de saída:{' '}
            <strong>"Lead respondeu"</strong> e{' '}
            <strong>"Sem resposta"</strong>. Conecte ambos os caminhos no canvas antes de publicar.
          </p>
        </div>
      )}

      {/* ── Aviso: voltando para modo legado ─────────────────────── */}
      {showTimeWarning && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 leading-snug">
            As conexões dos caminhos <strong>"Lead respondeu"</strong> e{' '}
            <strong>"Sem resposta"</strong> não são válidas no modo por tempo.
            Reconecte ou remova essas conexões no canvas.
          </p>
        </div>
      )}

      {/* ── Duração ──────────────────────────────────────────────── */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {isTimeOrResponse ? 'Tempo máximo de espera' : 'Duração do Atraso'}
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min="1"
            value={duration}
            onChange={(e) => handleDurationChange(parseInt(e.target.value) || 1)}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-400 focus:border-transparent"
            aria-label={isTimeOrResponse ? 'Tempo máximo de espera' : 'Duração do atraso'}
          />
          <select
            value={unit}
            onChange={(e) => handleUnitChange(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-400 focus:border-transparent"
            aria-label="Unidade de tempo"
          >
            <option value="seconds">Segundos</option>
            <option value="minutes">Minutos</option>
            <option value="hours">Horas</option>
            <option value="days">Dias</option>
          </select>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {isTimeOrResponse
            ? 'O fluxo seguirá o caminho "Sem resposta" após este período.'
            : 'O fluxo aguardará este tempo antes de continuar.'}
        </p>
      </div>

      {/* ── Variável para salvar resposta (apenas no novo modo) ─── */}
      {isTimeOrResponse && (
        <div>
          <label
            htmlFor="delay-response-variable"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Variável para salvar a resposta{' '}
            <span className="text-gray-400 font-normal">(opcional)</span>
          </label>
          <input
            id="delay-response-variable"
            type="text"
            value={responseVariable}
            onChange={(e) => handleResponseVariableChange(e.target.value)}
            placeholder="Ex: resposta_lead"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-400 focus:border-transparent"
          />
          <p className="text-xs text-gray-500 mt-1">
            Opcional. A resposta do lead será salva nesta variável para uso nos próximos nós.
          </p>
        </div>
      )}

      {/* ── Preview ──────────────────────────────────────────────── */}
      <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
        <p className="text-sm text-orange-900">
          {isTimeOrResponse ? (
            <>
              🔔 Aguardará resposta do lead ou <strong>{duration} {unitLabel}</strong>
            </>
          ) : (
            <>
              ⏱️ Aguardará <strong>{duration} {unitLabel}</strong> antes de continuar
            </>
          )}
        </p>
      </div>
    </div>
  )
}
