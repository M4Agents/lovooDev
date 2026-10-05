import React, { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { CustomActivityType } from '../../types/calendar'
import { DURATION_OPTIONS, REMINDER_OPTIONS } from '../../types/calendar'
import { presetOffsetValidationError } from '../../utils/applyActivityTypePreset'

interface ActivityTypePresetEditorProps {
  companyId: string
  type: CustomActivityType
  onSaved: () => Promise<void> | void
}

function textValue(value: string | null | undefined): string {
  return value ?? ''
}

function numberValue(value: number | null | undefined): string {
  return value == null ? '' : String(value)
}

export const ActivityTypePresetEditor: React.FC<ActivityTypePresetEditorProps> = ({
  companyId,
  type,
  onSaved,
}) => {
  const [title, setTitle] = useState(textValue(type.preset_title))
  const [description, setDescription] = useState(textValue(type.preset_description))
  const [hours, setHours] = useState(numberValue(type.preset_offset_hours))
  const [minutes, setMinutes] = useState(numberValue(type.preset_offset_minutes))
  const [duration, setDuration] = useState(numberValue(type.preset_duration_minutes))
  const [reminder, setReminder] = useState(numberValue(type.preset_reminder_minutes))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')

  const parseOptional = (value: string): number | null => {
    const trimmed = value.trim()
    if (trimmed === '') return null
    return Number(trimmed)
  }

  const handleSave = async () => {
    const offsetError = presetOffsetValidationError(parseOptional(hours), parseOptional(minutes))
    if (offsetError) {
      setError(offsetError)
      setSavedMessage('')
      return
    }

    setSaving(true)
    setError('')
    setSavedMessage('')
    const { error: rpcError } = await supabase.rpc('set_activity_type_preset', {
      p_company_id: companyId,
      p_type_id: type.id,
      p_preset_title: title.trim() === '' ? null : title.trim(),
      p_preset_description: description.trim() === '' ? null : description.trim(),
      p_preset_offset_hours: parseOptional(hours),
      p_preset_offset_minutes: parseOptional(minutes),
      p_preset_duration_minutes: parseOptional(duration),
      p_preset_reminder_minutes: parseOptional(reminder),
    })
    setSaving(false)
    if (rpcError) {
      setError(rpcError.message || 'Não foi possível salvar a regra.')
      return
    }
    setSavedMessage('Regra salva com sucesso.')
    await onSaved()
  }

  const clearSavedMessage = () => {
    if (savedMessage) setSavedMessage('')
  }

  return (
    <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
      <p className="text-xs text-slate-500">Campo vazio não entra no formulário. Zero é um valor.</p>
      <input
        value={title}
        onChange={(event) => {
          setTitle(event.target.value)
          clearSavedMessage()
        }}
        placeholder="Título"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
      />
      <textarea
        value={description}
        onChange={(event) => {
          setDescription(event.target.value)
          clearSavedMessage()
        }}
        placeholder="Descrição"
        rows={2}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={hours}
          onChange={(event) => {
            setHours(event.target.value)
            clearSavedMessage()
          }}
          inputMode="numeric"
          placeholder="Horas do prazo"
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
        <input
          value={minutes}
          onChange={(event) => {
            setMinutes(event.target.value)
            clearSavedMessage()
          }}
          inputMode="numeric"
          placeholder="Minutos do prazo"
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={duration}
          onChange={(event) => {
            setDuration(event.target.value)
            clearSavedMessage()
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">Duração: não preencher</option>
          {DURATION_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <select
          value={reminder}
          onChange={(event) => {
            setReminder(event.target.value)
            clearSavedMessage()
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">Lembrete: não preencher</option>
          {REMINDER_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {savedMessage && <p className="text-xs text-green-700">{savedMessage}</p>}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium disabled:opacity-50"
      >
        {saving ? 'Salvando...' : 'Salvar regra'}
      </button>
    </div>
  )
}
