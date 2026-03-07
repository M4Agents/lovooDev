import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { calendarApi } from '../../services/calendarApi'
import { supabase } from '../../lib/supabase'
import type { LeadActivity, CreateActivityForm } from '../../types/calendar'
import { ACTIVITY_TYPES, PRIORITIES, DURATION_OPTIONS, REMINDER_OPTIONS } from '../../types/calendar'

interface ActivityModalProps {
  activity: LeadActivity | null
  onClose: () => void
  onSave: () => void
}

interface Lead {
  id: number
  name: string
  phone?: string
  email?: string
}

export const ActivityModal: React.FC<ActivityModalProps> = ({
  activity,
  onClose,
  onSave
}) => {
  const { user, company } = useAuth()
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  
  const [formData, setFormData] = useState<CreateActivityForm>({
    lead_id: 0,
    title: '',
    description: '',
    activity_type: 'task',
    scheduled_date: '',
    scheduled_time: '',
    duration_minutes: 30,
    reminder_minutes: 15,
    priority: 'medium',
    visibility: 'private'
  })

  // Carregar dados da atividade se estiver editando
  useEffect(() => {
    if (activity) {
      setFormData({
        lead_id: activity.lead_id,
        title: activity.title,
        description: activity.description || '',
        activity_type: activity.activity_type,
        scheduled_date: activity.scheduled_date,
        scheduled_time: activity.scheduled_time,
        duration_minutes: activity.duration_minutes,
        assigned_to: activity.assigned_to,
        reminder_minutes: activity.reminder_minutes,
        priority: activity.priority,
        visibility: activity.visibility
      })
      
      if (activity.lead) {
        setSelectedLead({
          id: activity.lead.id,
          name: activity.lead.name,
          phone: activity.lead.phone,
          email: activity.lead.email
        })
      }
    } else {
      // Definir data/hora mínima como agora
      const now = new Date()
      const minDate = now.toISOString().split('T')[0]
      const minTime = now.toTimeString().slice(0, 5)
      
      setFormData(prev => ({
        ...prev,
        scheduled_date: minDate,
        scheduled_time: minTime
      }))
    }
  }, [activity])

  // Buscar leads
  useEffect(() => {
    const fetchLeads = async () => {
      if (!company?.id || searchTerm.length < 2) return

      try {
        const { data, error } = await supabase
          .from('leads')
          .select('id, name, phone, email')
          .eq('company_id', company.id)
          .is('deleted_at', null)
          .or(`name.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
          .limit(10)

        if (error) throw error
        setLeads(data || [])
      } catch (error) {
        console.error('Error fetching leads:', error)
      }
    }

    const debounce = setTimeout(fetchLeads, 300)
    return () => clearTimeout(debounce)
  }, [searchTerm, company?.id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!user?.id || !company?.id || !selectedLead) {
      alert('Por favor, selecione um lead')
      return
    }

    // Validar data/hora não pode ser no passado
    const scheduledDateTime = new Date(`${formData.scheduled_date}T${formData.scheduled_time}`)
    if (scheduledDateTime < new Date()) {
      alert('A data e hora não podem ser no passado')
      return
    }

    try {
      setLoading(true)

      const dataToSave = {
        ...formData,
        lead_id: selectedLead.id
      }

      if (activity) {
        // Atualizar
        await calendarApi.updateActivity(activity.id, dataToSave)
      } else {
        // Criar
        await calendarApi.createActivity(company.id, user.id, dataToSave)
      }

      onSave()
    } catch (error) {
      console.error('Error saving activity:', error)
      alert('Erro ao salvar atividade')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectLead = (lead: Lead) => {
    setSelectedLead(lead)
    setSearchTerm('')
    setLeads([])
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            {activity ? '✏️ Editar Atividade' : '📅 Nova Atividade'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Tipo de Atividade */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              🎯 Tipo de Atividade *
            </label>
            <select
              value={formData.activity_type}
              onChange={(e) => setFormData({ ...formData, activity_type: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              {ACTIVITY_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.icon} {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Lead */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              👤 Lead *
            </label>
            {selectedLead ? (
              <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">{selectedLead.name}</p>
                  <p className="text-sm text-gray-600">{selectedLead.phone || selectedLead.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLead(null)}
                  className="text-red-600 hover:text-red-800 text-sm"
                >
                  Remover
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar lead por nome, telefone ou email..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {leads.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {leads.map(lead => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => handleSelectLead(lead)}
                        className="w-full text-left p-3 hover:bg-gray-50 border-b border-gray-100 last:border-0"
                      >
                        <p className="font-medium text-gray-900">{lead.name}</p>
                        <p className="text-sm text-gray-600">{lead.phone || lead.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Título */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              📝 Título *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ex: Follow-up sobre proposta"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              📄 Descrição
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Detalhes da atividade..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Data, Hora e Duração */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                📅 Data *
              </label>
              <input
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ⏰ Hora *
              </label>
              <input
                type="time"
                value={formData.scheduled_time}
                onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ⏱ Duração
              </label>
              <select
                value={formData.duration_minutes}
                onChange={(e) => setFormData({ ...formData, duration_minutes: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {DURATION_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Lembrete e Prioridade */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                🔔 Lembrete
              </label>
              <select
                value={formData.reminder_minutes}
                onChange={(e) => setFormData({ ...formData, reminder_minutes: Number(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {REMINDER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ⚡ Prioridade
              </label>
              <div className="flex gap-2">
                {PRIORITIES.map(priority => (
                  <button
                    key={priority.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, priority: priority.value })}
                    className={`flex-1 px-3 py-2 rounded-lg border-2 transition-all ${
                      formData.priority === priority.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <span className="text-lg">{priority.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Visibilidade */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              👁️ Visibilidade
            </label>
            <select
              value={formData.visibility}
              onChange={(e) => setFormData({ ...formData, visibility: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="private">🔒 Privado (apenas eu)</option>
              <option value="shared">👥 Compartilhado (com permissões)</option>
              <option value="public">🌐 Público (toda empresa)</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !selectedLead}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Salvando...' : activity ? 'Atualizar' : 'Agendar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
