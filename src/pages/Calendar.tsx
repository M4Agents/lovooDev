import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { calendarApi } from '../services/calendarApi'
import { Calendar as CalendarIcon, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import type { LeadActivity, CalendarUser, ActivityFilter, CalendarView } from '../types/calendar'
import { ActivityModal } from '../components/Calendar/ActivityModal'
import { MonthView } from '../components/Calendar/MonthView'
import { WeekView } from '../components/Calendar/WeekView'
import { DayView } from '../components/Calendar/DayView'
import { ViewSelector } from '../components/Calendar/ViewSelector'
import { UserAvatarBar } from '../components/Calendar/UserAvatarBar'
import { CalendarSidebar } from '../components/Calendar/CalendarSidebar'

export const Calendar: React.FC = () => {
  const { user, company } = useAuth()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [currentView, setCurrentView] = useState<CalendarView>('month')
  const [selectedUserId, setSelectedUserId] = useState<string>('')
  const [activities, setActivities] = useState<LeadActivity[]>([])
  const [selectedCalendars, setSelectedCalendars] = useState<string[]>([])
  const [availableCalendars, setAvailableCalendars] = useState<CalendarUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showActivityModal, setShowActivityModal] = useState(false)
  const [selectedActivity, setSelectedActivity] = useState<LeadActivity | null>(null)
  const [todayCount, setTodayCount] = useState(0)

  // Inicializar usuário selecionado e calendários
  useEffect(() => {
    if (user?.id) {
      setSelectedUserId(user.id)
      setSelectedCalendars([user.id])
    }
  }, [user?.id])

  // Buscar calendários acessíveis
  useEffect(() => {
    const fetchCalendars = async () => {
      if (!user?.id || !company?.id) return

      try {
        const accessible = await calendarApi.getAccessibleCalendars(user.id)
        
        // Adicionar próprio calendário
        const ownCalendar: CalendarUser = {
          id: user.id,
          email: user.email || '',
          display_name: 'Meu Calendário',
          color: '#3B82F6',
          is_own: true
        }

        setAvailableCalendars([ownCalendar, ...accessible])
      } catch (error) {
        console.error('Error fetching calendars:', error)
      }
    }

    fetchCalendars()
  }, [user?.id, company?.id])

  // Buscar atividades do período atual
  useEffect(() => {
    const fetchActivities = async () => {
      if (!company?.id || !selectedUserId) return

      try {
        setLoading(true)
        
        const startOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
        const endOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)

        const filter: ActivityFilter = {
          start_date: startOfMonth,
          end_date: endOfMonth
        }

        const data = await calendarApi.getActivities(company.id, filter)
        
        // Filtrar por usuário selecionado na barra de avatares
        let filtered = data.filter(activity => activity.owner_user_id === selectedUserId)
        
        // Se sidebar tem outros calendários selecionados, adicionar atividades deles também
        if (selectedCalendars.length > 1) {
          const additionalActivities = data.filter(activity => 
            selectedCalendars.includes(activity.owner_user_id) && 
            activity.owner_user_id !== selectedUserId
          )
          filtered = [...filtered, ...additionalActivities]
        }
        
        setActivities(filtered)
      } catch (error) {
        console.error('Error fetching activities:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchActivities()
  }, [company?.id, currentDate, selectedUserId, selectedCalendars])

  // Buscar contagem de atividades de hoje do usuário selecionado
  useEffect(() => {
    const fetchTodayCount = async () => {
      if (!company?.id || !selectedUserId) return

      try {
        const count = await calendarApi.getTodayActivitiesCount(company.id, selectedUserId)
        setTodayCount(count)
      } catch (error) {
        console.error('Error fetching today count:', error)
      }
    }

    fetchTodayCount()
  }, [company?.id, selectedUserId])

  const handlePrevious = () => {
    const newDate = new Date(currentDate)
    if (currentView === 'month') {
      newDate.setMonth(newDate.getMonth() - 1)
    } else if (currentView === 'week') {
      newDate.setDate(newDate.getDate() - 7)
    } else {
      newDate.setDate(newDate.getDate() - 1)
    }
    setCurrentDate(newDate)
  }

  const handleNext = () => {
    const newDate = new Date(currentDate)
    if (currentView === 'month') {
      newDate.setMonth(newDate.getMonth() + 1)
    } else if (currentView === 'week') {
      newDate.setDate(newDate.getDate() + 7)
    } else {
      newDate.setDate(newDate.getDate() + 1)
    }
    setCurrentDate(newDate)
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  const handleCreateActivity = () => {
    setSelectedActivity(null)
    setShowActivityModal(true)
  }

  const handleEditActivity = (activity: LeadActivity) => {
    setSelectedActivity(activity)
    setShowActivityModal(true)
  }

  const handleActivitySaved = () => {
    setShowActivityModal(false)
    setSelectedActivity(null)
    // Recarregar atividades
    setCurrentDate(new Date(currentDate))
  }

  const handleToggleCalendar = (userId: string) => {
    setSelectedCalendars(prev => 
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const getNavigationLabel = () => {
    if (currentView === 'month') {
      return currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    } else if (currentView === 'week') {
      const startOfWeek = new Date(currentDate)
      const day = startOfWeek.getDay()
      startOfWeek.setDate(startOfWeek.getDate() - day)
      const endOfWeek = new Date(startOfWeek)
      endOfWeek.setDate(endOfWeek.getDate() + 6)
      return `${startOfWeek.getDate()} - ${endOfWeek.getDate()} de ${startOfWeek.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`
    } else {
      return currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    }
  }

  if (!user || !company) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-600">Carregando...</p>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header Premium */}
      <div className="bg-gradient-to-r from-white via-blue-50/50 to-white border-b border-blue-100/50 px-6 py-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg shadow-blue-500/30">
              <CalendarIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent tracking-tight">Calendário</h1>
              <p className="text-sm text-gray-600">
                {todayCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium text-xs animate-pulse">
                    <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                    {todayCount} {todayCount === 1 ? 'atividade' : 'atividades'} hoje
                  </span>
                ) : (
                  <span className="text-gray-500">Gerencie suas atividades</span>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={handleCreateActivity}
            className="group flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl hover:from-blue-700 hover:to-blue-600 transition-all duration-300 shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40 hover:scale-105 active:scale-95"
          >
            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
            <span className="font-medium">Nova Atividade</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <CalendarSidebar
          availableCalendars={availableCalendars}
          selectedCalendars={selectedCalendars}
          onToggleCalendar={handleToggleCalendar}
        />

        {/* Calendar View */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Navigation Premium */}
          <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 px-6 py-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={handlePrevious}
                  className="p-2.5 hover:bg-blue-50 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95 group"
                >
                  <ChevronLeft className="w-5 h-5 text-gray-600 group-hover:text-blue-600 transition-colors" />
                </button>
                
                <h2 className="text-xl font-bold text-gray-900 capitalize min-w-[200px] text-center tracking-tight">
                  {getNavigationLabel()}
                </h2>
                
                <button
                  onClick={handleNext}
                  className="p-2.5 hover:bg-blue-50 rounded-xl transition-all duration-200 hover:scale-110 active:scale-95 group"
                >
                  <ChevronRight className="w-5 h-5 text-gray-600 group-hover:text-blue-600 transition-colors" />
                </button>
              </div>

              {/* User Avatar Bar - Centro */}
              {availableCalendars.length > 0 && (
                <UserAvatarBar
                  currentUser={availableCalendars.find(cal => cal.is_own) || availableCalendars[0]}
                  availableCalendars={availableCalendars}
                  selectedUserId={selectedUserId}
                  onSelectUser={setSelectedUserId}
                />
              )}

              <div className="flex items-center gap-3">
                <ViewSelector
                  currentView={currentView}
                  onViewChange={setCurrentView}
                />
                
                <button
                  onClick={handleToday}
                  className="px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 border border-blue-200/50"
                >
                  Hoje
                </button>
              </div>
            </div>
          </div>

          {/* Month View */}
          <div className="flex-1 overflow-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <div className="relative">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-200 border-t-blue-600 mx-auto mb-4"></div>
                    <div className="absolute inset-0 animate-ping rounded-full h-12 w-12 border-4 border-blue-400 opacity-20 mx-auto"></div>
                  </div>
                  <p className="text-gray-600 font-medium">Carregando atividades...</p>
                </div>
              </div>
            ) : (
              <>
                {currentView === 'month' && (
                  <MonthView
                    currentDate={currentDate}
                    activities={activities}
                    availableCalendars={availableCalendars}
                    onEditActivity={handleEditActivity}
                  />
                )}
                {currentView === 'week' && (
                  <WeekView
                    currentDate={currentDate}
                    activities={activities}
                    availableCalendars={availableCalendars}
                    onEditActivity={handleEditActivity}
                  />
                )}
                {currentView === 'day' && (
                  <DayView
                    currentDate={currentDate}
                    activities={activities}
                    availableCalendars={availableCalendars}
                    onEditActivity={handleEditActivity}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Activity Modal */}
      {showActivityModal && (
        <ActivityModal
          activity={selectedActivity}
          onClose={() => {
            setShowActivityModal(false)
            setSelectedActivity(null)
          }}
          onSave={handleActivitySaved}
        />
      )}
    </div>
  )
}
