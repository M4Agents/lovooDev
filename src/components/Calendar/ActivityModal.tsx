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
  preSelectedLead?: Lead
  preSelectedDate?: string | null
}

interface Lead {
  id: number
  name: string
  phone?: string
  email?: string
}

interface CompanyUser {
  user_id: string
  email: string
  display_name: string
  profile_picture_url?: string
  is_active: boolean
}

export const ActivityModal: React.FC<ActivityModalProps> = ({
  activity,
  onClose,
  onSave,
  preSelectedLead,
  preSelectedDate
}) => {
  const { user, company } = useAuth()
  const [loading, setLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const [selectedResponsible, setSelectedResponsible] = useState<CompanyUser | null>(null)
  
  const [formData, setFormData] = useState<CreateActivityForm>({
    title: '',
    description: '',
    activity_type: 'task',
    scheduled_date: '',
    scheduled_time: '',
    duration_minutes: 30,
    reminder_minutes: 15,
    priority: 'medium',
    visibility: 'public'
  })

  // Buscar usuários da empresa
  useEffect(() => {
    const fetchCompanyUsers = async () => {
      if (!company?.id) return

      try {
        const { data, error } = await supabase
          .rpc('get_company_users_with_details', {
            p_company_id: company.id
          })
        
        if (error) throw error
        setCompanyUsers(data || [])
      } catch (error) {
        console.error('Error fetching company users:', error)
      }
    }

    fetchCompanyUsers()
  }, [company?.id])

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
      
      // Selecionar usuário responsável se existir
      if (activity.assigned_to && companyUsers.length > 0) {
        const responsible = companyUsers.find(u => u.user_id === activity.assigned_to)
        if (responsible) {
          setSelectedResponsible(responsible)
        }
      }
    } else {
      // Definir data/hora mínima como agora ou usar data pré-selecionada
      const now = new Date()
      const minDate = preSelectedDate || now.toISOString().split('T')[0]
      const minTime = '09:00' // Hora padrão quando clica na data
      
      setFormData(prev => ({
        ...prev,
        scheduled_date: minDate,
        scheduled_time: minTime
      }))
      
      // Pré-selecionar lead se fornecido (integração com Chat)
      if (preSelectedLead && !activity) {
        setSelectedLead(preSelectedLead)
      }
      
      // Selecionar usuário logado como responsável padrão
      if (user?.id && companyUsers.length > 0) {
        const currentUser = companyUsers.find(u => u.user_id === user.id)
        if (currentUser) {
          setSelectedResponsible(currentUser)
        }
      }
    }
  }, [activity, companyUsers, user?.id, preSelectedLead, preSelectedDate])

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
    
    // Lead é opcional - pode ser evento pessoal

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
        lead_id: selectedLead?.id || null,
        assigned_to: selectedResponsible?.user_id || user.id
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
        <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white">
          <h2 className="text-lg font-semibold bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
            {activity ? '✏️ Editar Atividade' : '📅 Nova Atividade'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          {/* Tipo de Atividade */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="text-sm">🎯</span>
              <span>Tipo de Atividade *</span>
            </label>
            <select
              value={formData.activity_type}
              onChange={(e) => setFormData({ ...formData, activity_type: e.target.value as any })}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
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
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="text-sm">👤</span>
              <span>Lead <span className="text-xs text-slate-400">(opcional)</span></span>
            </label>
            {selectedLead ? (
              <div className="flex items-center justify-between p-2.5 bg-gradient-to-r from-blue-50 to-blue-100/50 border border-blue-200 rounded-lg hover:shadow-sm transition-shadow">
                <div>
                  <p className="text-sm font-medium text-slate-900">{selectedLead.name}</p>
                  <p className="text-xs text-slate-600">{selectedLead.phone || selectedLead.email}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLead(null)}
                  className="text-red-600 hover:text-red-800 text-xs font-medium"
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
                  className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
                />
                {leads.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {leads.map(lead => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => handleSelectLead(lead)}
                        className="w-full text-left p-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors"
                      >
                        <p className="text-sm font-medium text-slate-900">{lead.name}</p>
                        <p className="text-xs text-slate-600">{lead.phone || lead.email}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Responsável pela Atividade */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="text-sm">👥</span>
              <span>Responsável *</span>
            </label>
            {selectedResponsible ? (
              <div className="flex items-center justify-between p-2.5 bg-gradient-to-r from-emerald-50 to-green-50 border border-emerald-200 rounded-lg hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2.5">
                  {selectedResponsible.profile_picture_url ? (
                    <img 
                      src={selectedResponsible.profile_picture_url} 
                      alt={selectedResponsible.display_name}
                      className="w-8 h-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-white text-sm font-semibold">
                      {selectedResponsible.display_name?.charAt(0)?.toUpperCase() || 'U'}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-slate-900">{selectedResponsible.display_name}</p>
                    <p className="text-xs text-slate-600">{selectedResponsible.email}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedResponsible(null)}
                  className="text-red-600 hover:text-red-800 text-xs font-medium"
                >
                  Alterar
                </button>
              </div>
            ) : (
              <select
                onChange={(e) => {
                  const selectedUser = companyUsers.find(u => u.user_id === e.target.value)
                  if (selectedUser) {
                    setSelectedResponsible(selectedUser)
                  }
                }}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
                required
              >
                <option value="">Selecione o responsável...</option>
                {user?.id && (
                  <option value={user.id}>👤 Eu mesmo</option>
                )}
                {companyUsers
                  .filter(u => u.user_id !== user?.id && u.is_active)
                  .map(u => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.display_name || u.email}
                    </option>
                  ))
                }
              </select>
            )}
          </div>

          {/* Título */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="text-sm">📝</span>
              <span>Título *</span>
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Ex: Follow-up sobre proposta"
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
              required
            />
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="text-sm">📄</span>
              <span>Descrição</span>
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Detalhes da atividade..."
              rows={2}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors resize-none"
            />
          </div>

          {/* Data e Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                <span className="text-sm">📅</span>
                <span>Data *</span>
              </label>
              <input
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                min={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                <span className="text-sm">⏰</span>
                <span>Hora *</span>
              </label>
              <input
                type="time"
                value={formData.scheduled_time}
                onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
                required
              />
            </div>
          </div>

          {/* Duração */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="text-sm">⏱</span>
              <span>Duração</span>
            </label>
            <select
              value={formData.duration_minutes}
              onChange={(e) => setFormData({ ...formData, duration_minutes: Number(e.target.value) })}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
            >
              {DURATION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Lembrete e Prioridade */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                <span className="text-sm">🔔</span>
                <span>Lembrete</span>
              </label>
              <select
                value={formData.reminder_minutes}
                onChange={(e) => setFormData({ ...formData, reminder_minutes: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
              >
                {REMINDER_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
                <span className="text-sm">⚡</span>
                <span>Prioridade</span>
              </label>
              <div className="flex gap-2">
                {PRIORITIES.map(priority => (
                  <button
                    key={priority.value}
                    type="button"
                    onClick={() => setFormData({ ...formData, priority: priority.value })}
                    className={`flex-1 px-2 py-1.5 rounded-lg border transition-all ${
                      formData.priority === priority.value
                        ? 'border-indigo-500 bg-gradient-to-br from-indigo-50 to-blue-100 shadow-sm scale-105'
                        : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-base">{priority.icon}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Visibilidade */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1 flex items-center gap-1.5">
              <span className="text-sm">👁️</span>
              <span>Visibilidade</span>
            </label>
            <select
              value={formData.visibility}
              onChange={(e) => setFormData({ ...formData, visibility: e.target.value as any })}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
            >
              <option value="private">🔒 Privado (apenas eu)</option>
              <option value="shared">👥 Compartilhado (com permissões)</option>
              <option value="public">🌐 Público (toda empresa)</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || !selectedLead}
              className="flex-1 px-4 py-2 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-lg hover:from-indigo-700 hover:to-blue-700 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Salvando...
                </span>
              ) : (
                activity ? '✅ Atualizar' : '📅 Agendar'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
