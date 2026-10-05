import { useEffect, useState } from 'react'
import { ActivityModal } from '../../Calendar/ActivityModal'
import ChatModalSimple from '../../SalesFunnel/ChatModalSimple'
import { useAuth } from '../../../contexts/AuthContext'
import { useDashboardEntityActions } from '../../../hooks/dashboard/useDashboardEntityActions'
import { useTaskBoard } from '../../../hooks/dashboard/useTaskBoard'
import { calendarApi } from '../../../services/calendarApi'
import type { TaskBoardActivity } from '../../../services/taskBoardApi'
import type { CustomActivityType, LeadActivity } from '../../../types/calendar'
import type { DashboardUser } from '../../../types/dashboard'
import { TASK_SEARCH_LIMITS } from '../../../utils/taskBoardContract'
import { TaskBoardCards } from './TaskBoardCards'
import { TaskBoardFilters } from './TaskBoardFilters'
import { TaskBoardList } from './TaskBoardList'
import { TaskReadPanel } from './TaskReadPanel'

interface Props {
  users: DashboardUser[]
}

export function TaskBoard({ users }: Props) {
  const { company, user } = useAuth()
  const companyId = company?.id ?? null
  const actions = useDashboardEntityActions({ companyId })
  const board = useTaskBoard({ companyId, userId: user?.id ?? null, active: true })
  const [types, setTypes] = useState<CustomActivityType[]>([])
  const [reading, setReading] = useState<TaskBoardActivity | null>(null)
  const [editing, setEditing] = useState<LeadActivity | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/activity-types?company_id=${companyId}`)
      .then(response => response.json())
      .then((rows: CustomActivityType[]) => {
        if (!cancelled && Array.isArray(rows)) setTypes(rows)
      })
      .catch(() => {
        if (!cancelled) setTypes([])
      })
    return () => { cancelled = true }
  }, [companyId])

  useEffect(() => {
    setReading(null)
    setEditing(null)
    setConfirming(false)
  }, [companyId])

  const rangePending = board.controls.date === 'range' && (!board.controls.from || !board.controls.to)
  const showResponsible = board.data?.scope === 'company'

  const finish = async (activity: TaskBoardActivity) => {
    if (!companyId || !user?.id) return
    setActionError(null)
    try {
      await calendarApi.completeActivity(activity.id, user.id, companyId)
      setConfirming(false)
      setReading(null)
      await board.reload()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível finalizar a tarefa')
    }
  }

  return (
    <section className="space-y-4">
      <TaskBoardFilters
        controls={board.controls}
        scope={board.data?.scope ?? null}
        users={users}
        types={types}
        onChange={board.patch}
      />
      <TaskBoardCards
        counts={board.data?.counts ?? null}
        card={board.controls.card}
        windowMinutes={board.controls.windowMinutes}
        onSelect={card => board.patch({ card })}
      />

      {board.loading && !board.data && (
        <p className="text-sm text-gray-500">Carregando tarefas...</p>
      )}
      {board.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>{board.error}</p>
          <button type="button" onClick={() => void board.reload()} className="mt-2 font-medium underline">Tentar de novo</button>
        </div>
      )}
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}
      {rangePending && !board.error && (
        <p className="text-sm text-gray-500">Informe as datas De e Até para ver o período.</p>
      )}
      {board.data?.truncated && (
        <p className="text-sm font-medium text-amber-800">
          Exibindo {TASK_SEARCH_LIMITS.listLimit} de {board.data.list_total} tarefas. Refine os filtros.
        </p>
      )}
      {board.loading && board.data && (
        <p className="text-xs text-gray-400">Atualizando...</p>
      )}

      {!board.loading && !board.error && !rangePending && board.data && board.data.activities.length === 0 && (
        <p className="rounded-xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          Nenhuma tarefa neste filtro.
        </p>
      )}

      {board.data && board.data.activities.length > 0 && (
        <TaskBoardList
          activities={board.data.activities}
          timezone={board.data.timezone}
          users={users}
          types={types}
          showResponsible={showResponsible}
          selectedId={reading?.id ?? null}
          onOpen={activity => { setReading(activity); setConfirming(false) }}
          onChat={activity => { if (activity.lead_id != null) actions.openChat(activity.lead_id) }}
          onEdit={activity => setEditing(toModalActivity(activity))}
          onComplete={activity => { setReading(activity); setConfirming(true) }}
        />
      )}

      {reading && board.data && (
        <TaskReadPanel
          activity={reading}
          timezone={board.data.timezone}
          users={users}
          types={types}
          showResponsible={showResponsible}
          confirming={confirming}
          onClose={() => { setReading(null); setConfirming(false) }}
          onChat={() => { if (reading.lead_id != null) actions.openChat(reading.lead_id) }}
          onEdit={() => setEditing(toModalActivity(reading))}
          onComplete={() => setConfirming(true)}
          onConfirmComplete={() => void finish(reading)}
          onCancelComplete={() => setConfirming(false)}
        />
      )}

      {editing && (
        <ActivityModal
          activity={editing}
          showChatButton
          onClose={() => setEditing(null)}
          onSave={() => {
            setEditing(null)
            void board.reload()
          }}
        />
      )}

      {actions.chatOpen && actions.chatLeadId != null && actions.companyId && actions.userId && (
        <ChatModalSimple
          isOpen={actions.chatOpen}
          onClose={actions.closeChat}
          leadId={actions.chatLeadId}
          companyId={actions.companyId}
          userId={actions.userId}
        />
      )}
    </section>
  )
}

function toModalActivity(activity: TaskBoardActivity): LeadActivity {
  const time = activity.scheduled_time.slice(0, 5)
  return {
    id: activity.id,
    company_id: activity.company_id,
    lead_id: activity.lead_id ?? undefined,
    title: activity.title,
    description: activity.description ?? undefined,
    activity_type: activity.activity_type as LeadActivity['activity_type'],
    scheduled_date: activity.scheduled_date,
    scheduled_time: time,
    scheduled_datetime: activity.scheduled_datetime
      ? new Date(activity.scheduled_datetime)
      : new Date(`${activity.scheduled_date}T${time}:00Z`),
    duration_minutes: activity.duration_minutes,
    status: activity.status as LeadActivity['status'],
    owner_user_id: activity.owner_user_id,
    assigned_to: activity.assigned_to ?? undefined,
    created_by: activity.created_by,
    reminder_minutes: activity.reminder_minutes,
    notification_sent: activity.notification_sent,
    priority: activity.priority as LeadActivity['priority'],
    visibility: activity.visibility as LeadActivity['visibility'],
    created_at: new Date(activity.created_at),
    updated_at: new Date(activity.updated_at),
    lead: activity.lead ?? undefined,
  }
}
