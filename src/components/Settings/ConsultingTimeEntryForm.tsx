// =============================================================================
// src/components/Settings/ConsultingTimeEntryForm.tsx
//
// Formulário para lançar horas consultivas (platform_admin apenas).
// duration_minutes calculado no servidor — nunca construído no frontend.
// =============================================================================

import { useState } from 'react'
import { AlertCircle, Loader2, Clock } from 'lucide-react'
import { createTimeEntry, type NewTimeEntryPayload } from '../../services/consultingApi'

interface Props {
  companyId: string
  onSuccess: () => void
  onCancel:  () => void
}

const today = new Date().toISOString().split('T')[0]

const ENTRY_TYPES = [
  { value: 'implementation', label: 'Implementação' },
  { value: 'training',       label: 'Treinamento'   },
  { value: 'consulting',     label: 'Consultoria'   },
] as const

export function ConsultingTimeEntryForm({ companyId, onSuccess, onCancel }: Props) {
  const [form, setForm] = useState<NewTimeEntryPayload>({
    entry_date:  today,
    start_time:  '',
    end_time:    '',
    description: '',
    entry_type:  'consulting',
    performed_by_user_id: null,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  function set<K extends keyof NewTimeEntryPayload>(key: K, value: NewTimeEntryPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.entry_date || !form.start_time || !form.end_time || !form.description) {
      setError('Preencha todos os campos obrigatórios')
      return
    }
    if (form.end_time <= form.start_time) {
      setError('O horário de término deve ser posterior ao horário de início')
      return
    }

    setLoading(true)
    setError(null)
    try {
      await createTimeEntry(companyId, form)
      onSuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao registrar lançamento'
      setError(
        msg === 'insufficient_balance' || msg.includes('insufficient_balance')
          ? 'Saldo insuficiente para este lançamento'
          : msg
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
      <h4 className="text-sm font-semibold text-blue-800 flex items-center gap-2 mb-4">
        <Clock size={16} />Novo lançamento de horas
      </h4>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Data */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Data *</label>
            <input
              type="date"
              value={form.entry_date}
              onChange={(e) => set('entry_date', e.target.value)}
              max={today}
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>

          {/* Início */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Início *</label>
            <input
              type="time"
              value={form.start_time}
              onChange={(e) => set('start_time', e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>

          {/* Término */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Término *</label>
            <input
              type="time"
              value={form.end_time}
              onChange={(e) => set('end_time', e.target.value)}
              required
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
            />
          </div>
        </div>

        {/* Tipo de atividade */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Tipo de atividade *</label>
          <select
            value={form.entry_type}
            onChange={(e) => set('entry_type', e.target.value as NewTimeEntryPayload['entry_type'])}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
          >
            {ENTRY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Descrição *</label>
          <textarea
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Descreva as atividades realizadas..."
            rows={3}
            required
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white resize-none"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <AlertCircle size={14} />{error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition disabled:opacity-50"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {loading ? 'Registrando...' : 'Registrar lançamento'}
          </button>
        </div>
      </form>
    </div>
  )
}
