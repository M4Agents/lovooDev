// =====================================================
// COMPONENT: DELAY FORM
// Data: 15/03/2026
// Objetivo: Formulário para atraso de tempo
// =====================================================

import { useState, useEffect } from 'react'

interface DelayFormProps {
  config: {
    duration?: number
    unit?: 'seconds' | 'minutes' | 'hours' | 'days'
  }
  onChange: (config: any) => void
}

export default function DelayForm({ config, onChange }: DelayFormProps) {
  const [duration, setDuration] = useState(config.duration ?? 5)
  const [unit, setUnit] = useState(config.unit || 'seconds')

  // Sincronizar valores iniciais com o config ao montar
  useEffect(() => {
    // Passar valores iniciais para o onChange se ainda não existirem no config
    if (config.duration === undefined || config.unit === undefined) {
      onChange({
        ...config,
        duration: duration,
        unit: unit
      })
    }
  }, [])

  const handleChange = (field: string, value: any) => {
    onChange({ ...config, [field]: value })
  }

  return (
    <div className="space-y-4">
      {/* Duração */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Duração do Atraso
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min="1"
            value={duration}
            onChange={(e) => {
              setDuration(parseInt(e.target.value) || 1)
              handleChange('duration', parseInt(e.target.value) || 1)
            }}
            className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <select
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value as any)
              handleChange('unit', e.target.value)
            }}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="seconds">Segundos</option>
            <option value="minutes">Minutos</option>
            <option value="hours">Horas</option>
            <option value="days">Dias</option>
          </select>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          O fluxo aguardará este tempo antes de continuar
        </p>
      </div>

      {/* Preview */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-900">
          ⏱️ Aguardará <strong>{duration} {
            unit === 'seconds' ? 'segundo(s)' :
            unit === 'minutes' ? 'minuto(s)' :
            unit === 'hours' ? 'hora(s)' :
            'dia(s)'
          }</strong> antes de continuar
        </p>
      </div>
    </div>
  )
}
