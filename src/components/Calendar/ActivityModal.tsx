import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { calendarApi } from '../../services/calendarApi'
import { supabase } from '../../lib/supabase'
import type { LeadActivity, CreateActivityForm } from '../../types/calendar'
import { ACTIVITY_TYPES, PRIORITIES, DURATION_OPTIONS, REMINDER_OPTIONS } from '../../types/calendar'
import ChatModalSimple from '../SalesFunnel/ChatModalSimple'

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
  const [deleting, setDeleting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const [selectedResponsible, setSelectedResponsible] = useState<CompanyUser | null>(null)
  const [hasGoogleConnection, setHasGoogleConnection] = useState(false)
  const [showChatModal, setShowChatModal] = useState(false)
  const [showCompletionModal, setShowCompletionModal] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')
  
  const [formData, setFormData] = useState<CreateActivityForm>({
    title: '',
    description: '',
    activity_type: 'task',
    scheduled_date: '',
    scheduled_time: '',
    duration_minutes: 30,
    reminder_minutes: 15,
    priority: 'medium',
    visibility: 'public',
    sync_to_google: false
  })

  // Verificar conexão com Google Calendar
  useEffect(() => {
    const checkGoogleConnection = async () => {
      if (!user?.id) return

      try {
        const { data, error } = await supabase
          .from('google_calendar_connections')
          .select('id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .single()

        setHasGoogleConnection(!!data && !error)
      } catch (error) {
        console.error('Error checking Google connection:', error)
        setHasGoogleConnection(false)
      }
    }

    checkGoogleConnection()
  }, [user?.id])

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
      // Converter UTC para timezone local do usuário
      const utcDateTime = new Date(`${activity.scheduled_date}T${activity.scheduled_time}Z`)
      const localDate = utcDateTime.toLocaleDateString('en-CA') // YYYY-MM-DD
      const localTime = utcDateTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) // HH:mm
      
      setFormData({
        lead_id: activity.lead_id,
        title: activity.title,
        description: activity.description || '',
        activity_type: activity.activity_type,
        scheduled_date: localDate,
        scheduled_time: localTime,
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
      // Obter hora atual no timezone de São Paulo (Brasil)
      const minTime = now.toLocaleTimeString('pt-BR', { 
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      })
      
      setFormData(prev => ({
        ...prev,
        scheduled_date: minDate,
        scheduled_time: minTime,
        sync_to_google: hasGoogleConnection // Marcar por padrão se houver conexão
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
  }, [activity, companyUsers, user?.id, preSelectedLead, preSelectedDate, hasGoogleConnection])

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
    
    // Validar lead obrigatório
    if (!selectedLead) {
      alert('Por favor, selecione um lead para a atividade')
      return
    }

    // Validar data/hora não pode ser no passado (em horário local)
    const localDateTime = new Date(`${formData.scheduled_date}T${formData.scheduled_time}`)
    if (localDateTime < new Date()) {
      alert('A data e hora não podem ser no passado')
      return
    }

    try {
      setLoading(true)

      // Converter horário local para UTC antes de salvar
      const localDateTime = new Date(`${formData.scheduled_date}T${formData.scheduled_time}`)
      const utcDate = localDateTime.toISOString().split('T')[0] // YYYY-MM-DD em UTC
      const utcTime = localDateTime.toISOString().split('T')[1].substring(0, 8) // HH:mm:ss em UTC

      const dataToSave = {
        ...formData,
        scheduled_date: utcDate,
        scheduled_time: utcTime,
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

  const handleDelete = async () => {
    if (!activity) return
    
    if (!confirm('Tem certeza que deseja excluir esta atividade?')) {
      return
    }

    try {
      setDeleting(true)
      await calendarApi.deleteActivity(activity.id)
      onSave()
    } catch (error) {
      console.error('Error deleting activity:', error)
      alert('Erro ao excluir atividade')
    } finally {
      setDeleting(false)
    }
  }

  const handleComplete = async () => {
    if (!activity?.id || !user?.id) return

    try {
      setCompleting(true)
      await calendarApi.completeActivity(
        activity.id,
        user.id,
        completionNotes ? { completion_notes: completionNotes } : undefined
      )
      setShowCompletionModal(false)
      onSave()
      onClose()
    } catch (error) {
      console.error('Error completing activity:', error)
      alert('Erro ao concluir atividade')
    } finally {
      setCompleting(false)
    }
  }

  const handleOpenChat = () => {
    if (selectedLead) {
      setShowChatModal(true)
    }
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
              <span>Lead <span className="text-red-500">*</span></span>
            </label>
            {selectedLead ? (
              <div className="flex items-center justify-between p-2.5 bg-gradient-to-r from-blue-50 to-blue-100/50 border border-blue-200 rounded-lg hover:shadow-sm transition-shadow">
                <div>
                  <p className="text-sm font-medium text-slate-900">{selectedLead.name}</p>
                  <p className="text-xs text-slate-600">{selectedLead.phone || selectedLead.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenChat}
                    className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 transition-colors flex items-center gap-1.5"
                    title="Abrir chat do WhatsApp"
                  >
                    💬 Abrir Chat
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedLead(null)}
                    className="text-red-600 hover:text-red-800 text-xs font-medium"
                  >
                    Remover
                  </button>
                </div>
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

          {/* Sincronizar com Google Calendar */}
          <div className={`bg-gradient-to-r ${hasGoogleConnection ? 'from-blue-50 to-indigo-50 border-blue-200' : 'from-gray-50 to-slate-50 border-gray-300'} border rounded-lg p-3`}>
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={formData.sync_to_google || false}
                onChange={(e) => setFormData({ ...formData, sync_to_google: e.target.checked })}
                disabled={!hasGoogleConnection}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <div className="flex items-center gap-2 flex-1">
                <span className="text-lg">{hasGoogleConnection ? '📅' : '🔌'}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-800 group-hover:text-blue-700 transition-colors">
                      Sincronizar com Google Calendar
                    </p>
                    {hasGoogleConnection && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        ✓ Conectado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600">
                    {hasGoogleConnection 
                      ? 'Evento será criado automaticamente no seu Google Calendar'
                      : 'Conecte sua conta Google para sincronizar eventos automaticamente'
                    }
                  </p>
                </div>
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            {activity && (
              <>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                >
                  {deleting ? '🗑️ Excluindo...' : '🗑️ Excluir'}
                </button>
                {activity.status !== 'completed' && (
                  <button
                    type="button"
                    onClick={() => setShowCompletionModal(true)}
                    disabled={completing}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
                  >
                    ✅ Concluir
                  </button>
                )}
              </>
            )}
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

      {/* Modal de Chat do Lead */}
      {selectedLead && user && company && (
        <ChatModalSimple
          leadId={selectedLead.id}
          companyId={company.id}
          userId={user.id}
          isOpen={showChatModal}
          onClose={() => setShowChatModal(false)}
        />
      )}

      {/* Mini-Modal de Conclusão */}
      {showCompletionModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
              <span className="text-2xl">✅</span>
              Concluir Atividade
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              Adicione notas sobre a conclusão desta atividade (opcional):
            </p>
            <textarea
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              placeholder="Ex: Cliente confirmou interesse, agendar próxima reunião..."
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none"
              rows={4}
            />
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setShowCompletionModal(false)
                  setCompletionNotes('')
                }}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleComplete}
                disabled={completing}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {completing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Concluindo...
                  </span>
                ) : (
                  '✅ Confirmar Conclusão'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
