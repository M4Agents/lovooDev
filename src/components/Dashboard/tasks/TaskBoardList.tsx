import { PRIORITIES, ACTIVITY_TYPES, type CustomActivityType } from '../../../types/calendar'
import type { DashboardUser } from '../../../types/dashboard'
import { activityCompanyDate, activityCompanyTime } from '../../../utils/companyTime'
import { effectiveAssignee } from '../../../utils/taskBoardContract'
import type { TaskBoardActivity } from '../../../services/taskBoardApi'

interface Props {
  activities: TaskBoardActivity[]
  timezone: string
  users: DashboardUser[]
  types: CustomActivityType[]
  showResponsible: boolean
  selectedId: string | null
  onOpen: (activity: TaskBoardActivity) => void
  onChat: (activity: TaskBoardActivity) => void
  onEdit: (activity: TaskBoardActivity) => void
  onComplete: (activity: TaskBoardActivity) => void
}

export function TaskBoardList({
  activities, timezone, users, types, showResponsible, selectedId, onOpen, onChat, onEdit, onComplete,
}: Props) {
  return (
    <ul className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
      {activities.map(activity => {
        const responsibleId = effectiveAssignee(activity.assigned_to, activity.owner_user_id)
        const responsible = users.find(user => user.user_id === responsibleId)
        const when = activity.scheduled_datetime
          ? `${activityCompanyDate(activity, timezone)} ${activityCompanyTime(activity, timezone)}`
          : 'Sem data'
        return (
          <li key={activity.id}>
            <div
              role="button"
              tabIndex={0}
              onClick={() => onOpen(activity)}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') onOpen(activity)
              }}
              className={[
                'flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between',
                selectedId === activity.id ? 'bg-indigo-50' : 'hover:bg-gray-50',
              ].join(' ')}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{activity.title}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {typeLabel(activity.activity_type, types)}
                  {' · '}
                  {priorityLabel(activity.priority)}
                  {' · '}
                  {activity.lead?.name ?? 'Sem lead'}
                  {showResponsible ? ` · ${responsible?.display_name ?? 'Sem responsável'}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-700">{when}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {activity.lead_id != null && (
                  <button type="button" className={actionClass} onClick={event => { event.stopPropagation(); onChat(activity) }}>
                    Abrir chat
                  </button>
                )}
                <button type="button" className={actionClass} onClick={event => { event.stopPropagation(); onEdit(activity) }}>
                  Alterar
                </button>
                <button type="button" className={actionClass} onClick={event => { event.stopPropagation(); onComplete(activity) }}>
                  Finalizar
                </button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const actionClass = 'rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:border-indigo-300 hover:text-indigo-700'

function typeLabel(value: string, types: CustomActivityType[]): string {
  return types.find(type => type.id === value)?.name
    ?? ACTIVITY_TYPES.find(type => type.value === value)?.label
    ?? value
}

function priorityLabel(value: string): string {
  return PRIORITIES.find(item => item.value === value)?.label ?? value
}
