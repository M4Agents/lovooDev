import React, { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { calendarApi } from '../../services/calendarApi'
import { supabase } from '../../lib/supabase'
import type { LeadActivity, CreateActivityForm } from '../../types/calendar'
import { ACTIVITY_TYPES, PRIORITIES, DURATION_OPTIONS, REMINDER_OPTIONS } from '../../types/calendar'
import type { CustomActivityType } from '../../types/calendar'
import { applyActivityTypePreset, typeHasPreset } from '../../utils/applyActivityTypePreset'
import { companyWallFromInstant, companyWallToUtc, activityInstant } from '../../utils/companyTime'
import ChatModalSimple from '../SalesFunnel/ChatModalSimple'

interface ActivityModalProps {
  activity: LeadActivity | null
  onClose: () => void
  onSave: () => void
  preSelectedLead?: Lead
  preSelectedDate?: string | null
  preSelectedTime?: string | null  // DATETIME.2C
  showChatButton?: boolean
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
  preSelectedDate,
  preSelectedTime,  // DATETIME.2C
  showChatButton = false
}) => {
  const { user, company, companyTimezone } = useAuth()
  const [loading, setLoading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [activityTypes, setActivityTypes] = useState<CustomActivityType[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([])
  const [selectedResponsible, setSelectedResponsible] = useState<CompanyUser | null>(null)
  const [hasGoogleConnection, setHasGoogleConnection] = useState(false)
  const [showChatModal, setShowChatModal] = useState(false)
  const [showCompletionModal, setShowCompletionModal] = useState(false)
  const [completionNotes, setCompletionNotes] = useState('')
  const fieldsTouchedRef = useRef(false)
  const userChangedTypeRef = useRef(false)
  const initialPresetAppliedRef = useRef(false)
  const bootstrappedNewRef = useRef(false)
  const loadedActivityIdRef = useRef<string | null>(null)
  const originalScheduleRef = useRef<{ date: string; time: string } | null>(null)
  const syncTouchedRef = useRef(false)
  const markManual = () => {
    fieldsTouchedRef.current = true
  }
  
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

  // Carregar tipos de atividade dinâmicos (custom + sistema)
  useEffect(() => {
    if (!company?.id) return
    let cancelled = false
    const params = new URLSearchParams({ company_id: company.id })
    if (activity?.activity_type) params.set('current_id', activity.activity_type)
    fetch(`/api/activity-types?${params.toString()}`)
      .then(res => res.json())
      .then((data: CustomActivityType[]) => {
        if (cancelled || !Array.isArray(data) || data.length === 0) return
        setActivityTypes(data)
        if (activity || initialPresetAppliedRef.current) return
        initialPresetAppliedRef.current = true
        const visible = data.find(type => !type.is_hidden) ?? data[0]
        if (fieldsTouchedRef.current || userChangedTypeRef.current) {
          if (!userChangedTypeRef.current) {
            setFormData(prev => ({ ...prev, activity_type: visible.id as CreateActivityForm['activity_type'] }))
          }
          return
        }
        setFormData(prev => applyActivityTypePreset(prev, visible, companyTimezone))
      })
      .catch(() => {
        // Silencioso: fallback para lista estática no render
      })
    return () => {
      cancelled = true
    }
  }, [company?.id, activity?.activity_type, activity, companyTimezone])

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

  // Carregar a atividade uma vez. Recarga de usuários não recoloca data nem hora.
  useEffect(() => {
    if (activity) {
      if (loadedActivityIdRef.current !== activity.id) {
        loadedActivityIdRef.current = activity.id
        fieldsTouchedRef.current = false
        const wall = companyWallFromInstant(activityInstant(activity), companyTimezone)
        originalScheduleRef.current = { date: wall.date, time: wall.time }
        setFormData({
          lead_id: activity.lead_id,
          title: activity.title,
          description: activity.description || '',
          activity_type: activity.activity_type,
          scheduled_date: wall.date,
          scheduled_time: wall.time,
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
      }

      if (activity.assigned_to && companyUsers.length > 0) {
        const responsible = companyUsers.find(u => u.user_id === activity.assigned_to)
        if (responsible) setSelectedResponsible(responsible)
      }
      return
    }

    if (!bootstrappedNewRef.current) {
      bootstrappedNewRef.current = true
      const nowWall = companyWallFromInstant(new Date(), companyTimezone)
      setFormData(prev => ({
        ...prev,
        scheduled_date: preSelectedDate || nowWall.date,
        scheduled_time: preSelectedTime || nowWall.time,
        sync_to_google: hasGoogleConnection
      }))
    } else if (!fieldsTouchedRef.current && !initialPresetAppliedRef.current && !userChangedTypeRef.current) {
      const nowWall = companyWallFromInstant(new Date(), companyTimezone)
      setFormData(prev => ({
        ...prev,
        scheduled_date: preSelectedDate || nowWall.date,
        scheduled_time: preSelectedTime || nowWall.time
      }))
    }

    if (!activity && hasGoogleConnection && !syncTouchedRef.current) {
      setFormData(prev => (prev.sync_to_google ? prev : { ...prev, sync_to_google: true }))
    }

    if (preSelectedLead) setSelectedLead(preSelectedLead)
    if (user?.id && companyUsers.length > 0 && !selectedResponsible) {
      const currentUser = companyUsers.find(u => u.user_id === user.id)
      if (currentUser) setSelectedResponsible(currentUser)
    }
  }, [activity, companyUsers, user?.id, preSelectedLead, preSelectedDate, preSelectedTime, hasGoogleConnection, companyTimezone, selectedResponsible])

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

    const scheduleUnchanged = Boolean(
      activity
      && originalScheduleRef.current
      && formData.scheduled_date === originalScheduleRef.current.date
      && formData.scheduled_time.slice(0, 5) === originalScheduleRef.current.time
    )

    let utcDate = formData.scheduled_date
    let utcTime = formData.scheduled_time
    if (!scheduleUnchanged) {
      const converted = companyWallToUtc(formData.scheduled_date, formData.scheduled_time, companyTimezone)
      if (!converted.ok) {
        alert(converted.reason === 'nonexistent'
          ? 'Esse horário não existe no fuso da empresa.'
          : 'Data ou hora inválida')
        return
      }
      if (converted.instant.getTime() < Date.now()) {
        alert('A data e hora não podem ser no passado')
        return
      }
      utcDate = converted.utcDate
      utcTime = converted.utcTime
    }

    try {
      setLoading(true)

      const scheduleChanged = Boolean(activity) && !scheduleUnchanged

      const dataToSave = {
        ...formData,
        scheduled_date: utcDate,
        scheduled_time: utcTime,
        lead_id: selectedLead?.id || null,
        assigned_to: selectedResponsible?.user_id || user.id
      }

      if (activity) {
        // scheduled_date e scheduled_time saem do PATCH.
        // /reschedule só entra quando a data ou a hora exibidas mudaram.
        // ── Separar campos de agenda dos demais ──────────────────────────────
        // scheduled_date e scheduled_time foram removidos do PATCH whitelist:
        // qualquer mudança de agenda passa obrigatoriamente pelo /reschedule.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { scheduled_date: _sd, scheduled_time: _st, ...nonScheduleData } = dataToSave

        // ── Detectar se há mudanças reais em campos não relacionados à agenda ─
        // Evita chamada desnecessária ao PATCH quando somente data/hora mudaram.
        // Comparação simples por igualdade estrita nos campos da whitelist do PATCH.
        // Falso positivo (null vs '') é aceitável e inofensivo.
        const EDITABLE_FIELDS = [
          'title', 'description', 'activity_type', 'duration_minutes',
          'reminder_minutes', 'priority', 'visibility', 'assigned_to', 'sync_to_google',
        ] as const
        const hasNonScheduleChanges = EDITABLE_FIELDS.some(field => {
          const newVal = (nonScheduleData as Record<string, unknown>)[field]
          const oldVal = (activity as Record<string, unknown>)[field]
          return newVal !== oldVal
        })

        // ── Ordem correta das chamadas ────────────────────────────────────────
        // REGRA: quando scheduleChanged=true, o PATCH deve ocorrer ANTES do reschedule.
        // Motivo: rescheduleActivity() dispara o único Google Calendar sync (fire-and-forget)
        // APÓS o await do backend. Para que o Google receba o estado COMPLETO (nova data/hora
        // E novos campos normais), todos os campos não-agenda devem estar no banco antes de
        // o sync ser disparado.
        //
        // Cenário A — apenas título/prioridade/etc.:
        //   updateActivity() com Google sync normal
        //
        // Cenário B — apenas data/hora:
        //   rescheduleActivity() com Google sync
        //
        // Cenário C — data/hora + título/prioridade/etc.:
        //   1. updateActivity() → skipGoogleSync:true (salva campos normais, sem sync)
        //   2. rescheduleActivity() → await backend → fire-and-forget Google sync
        //      (neste ponto o banco já tem os campos normais novos + nova agenda)
        //
        // ── Risco de atomicidade (a documentar para avaliação futura) ────────
        // As duas chamadas (PATCH + reschedule) NÃO são transacionais.
        // Em Cenário C: se o PATCH suceder mas o reschedule falhar, o banco
        // terá novos campos normais mas agenda antiga. O usuário recebe erro e
        // pode repetir a operação (reagendamento idempotente).
        // Solução futura: RPC unificada no banco. Não implementar sem aprovação.

        if (hasNonScheduleChanges) {
          // PATCH primeiro — sem Google sync para evitar sincronização prematura
          await calendarApi.updateActivity(
            activity.id,
            nonScheduleData,
            company.id,
            { skipGoogleSync: scheduleChanged }
          )
        }

        if (scheduleChanged) {
          // Reschedule por último — dispara o ÚNICO Google sync com estado final completo
          // (neste ponto o banco já tem campos normais atualizados, se houver)
          await calendarApi.rescheduleActivity(
            activity.id,
            company.id,
            utcDate,
            utcTime
          )
        }

        // Se nenhuma mudança detectada: prossegue normalmente para onSave() fechar o modal
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
        company.id,  // 3º parâmetro obrigatório — validação multi-tenant no backend
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
              onChange={(e) => {
                const nextId = e.target.value
                userChangedTypeRef.current = true
                const selected = activityTypes.find(type => type.id === nextId)
                setFormData(prev => applyActivityTypePreset(
                  { ...prev, activity_type: nextId as CreateActivityForm['activity_type'] },
                  selected,
                  companyTimezone
                ))
              }}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent hover:border-slate-400 transition-colors"
              required
            >
              {activityTypes.length > 0 ? (
                <>
                  {activityTypes.map(type => (
                    <option key={type.id} value={type.id}>
                      {type.icon} {type.name}{type.is_hidden ? ' (oculto)' : ''}
                    </option>
                  ))}
                  {/* Fallback: se o valor atual é um tipo legado não presente na lista dinâmica */}
                  {!activityTypes.some(t => t.id === formData.activity_type) &&
                    ACTIVITY_TYPES.some(t => t.value === formData.activity_type) && (
                    <option value={formData.activity_type} disabled>
                      {ACTIVITY_TYPES.find(t => t.value === formData.activity_type)?.icon}{' '}
                      {ACTIVITY_TYPES.find(t => t.value === formData.activity_type)?.label} (legado)
                    </option>
                  )}
                </>
              ) : (
                // Enquanto carrega ou se empresa não tem tipos cadastrados
                ACTIVITY_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.icon} {type.label}
                  </option>
                ))
              )}
            </select>
            {activity && (
              <button
                type="button"
                disabled={!typeHasPreset(activityTypes.find(type => type.id === formData.activity_type))}
                onClick={() => {
                  const selected = activityTypes.find(type => type.id === formData.activity_type)
                  setFormData(prev => applyActivityTypePreset(prev, selected, companyTimezone))
                }}
                className="mt-2 text-xs font-medium text-indigo-700 hover:text-indigo-900 disabled:text-slate-400 disabled:cursor-not-allowed"
              >
                Aplicar regra do tipo
              </button>
            )}
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
                  {showChatButton && (
                    <button
                      type="button"
                      onClick={handleOpenChat}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-md hover:bg-green-700 transition-colors flex items-center gap-1.5"
                      title="Abrir chat do WhatsApp"
                    >
                      💬 Abrir Chat
                    </button>
                  )}
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
              onChange={(e) => { markManual(); setFormData({ ...formData, title: e.target.value }) }}
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
              onChange={(e) => { markManual(); setFormData({ ...formData, description: e.target.value }) }}
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
                onChange={(e) => { markManual(); setFormData({ ...formData, scheduled_date: e.target.value }) }}
                min={companyWallFromInstant(new Date(), companyTimezone).date}
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
                onChange={(e) => { markManual(); setFormData({ ...formData, scheduled_time: e.target.value }) }}
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
              onChange={(e) => { markManual(); setFormData({ ...formData, duration_minutes: Number(e.target.value) }) }}
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
                onChange={(e) => { markManual(); setFormData({ ...formData, reminder_minutes: Number(e.target.value) }) }}
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
                onChange={(e) => { syncTouchedRef.current = true; setFormData({ ...formData, sync_to_google: e.target.checked }) }}
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
