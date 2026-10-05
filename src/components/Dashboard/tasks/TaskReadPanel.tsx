import { PRIORITIES, ACTIVITY_TYPES, type CustomActivityType } from '../../../types/calendar'
import type { DashboardUser } from '../../../types/dashboard'
import { activityCompanyDate, activityCompanyTime } from '../../../utils/companyTime'
import { effectiveAssignee, taskDeadlineLabel, taskDeadlineTone, type WindowMinutes } from '../../../utils/taskBoardContract'
import { deadlineBadgeClass } from './taskDeadlineStyle'
import type { TaskBoardActivity } from '../../../services/taskBoardApi'

interface Props {
  activity: TaskBoardActivity
  timezone: string
  asOf: string
  windowMinutes: WindowMinutes
  users: DashboardUser[]
  types: CustomActivityType[]
  showResponsible: boolean
  confirming: boolean
  onClose: () => void
  onChat: () => void
  onEdit: () => void
  onComplete: () => void
  onConfirmComplete: () => void
  onCancelComplete: () => void
}

export function TaskReadPanel({
  activity, timezone, asOf, windowMinutes, users, types, showResponsible, confirming,
  onClose, onChat, onEdit, onComplete, onConfirmComplete, onCancelComplete,
}: Props) {
  const responsibleId = effectiveAssignee(activity.assigned_to, activity.owner_user_id)
  const responsible = users.find(user => user.user_id === responsibleId)
  const when = activity.scheduled_datetime
    ? `${activityCompanyDate(activity, timezone)} às ${activityCompanyTime(activity, timezone)}`
    : 'Sem data'
  const tone = taskDeadlineTone(activity.scheduled_datetime, asOf, timezone, windowMinutes)

  return (
    <aside className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Leitura da tarefa</p>
          <h2 className="mt-1 text-lg font-semibold text-gray-900">{activity.title}</h2>
        </div>
        <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">Fechar</button>
      </div>
      <dl className="mt-4 space-y-2 text-sm text-gray-700">
        <div>
          <dt className="text-xs text-gray-500">Quando</dt>
          <dd className="mt-1 flex flex-wrap items-center gap-2">
            <span>{when}</span>
            <span className={['rounded-full border px-2 py-0.5 text-xs font-medium', deadlineBadgeClass(tone)].join(' ')}>
              {taskDeadlineLabel(tone)}
            </span>
          </dd>
        </div>
        <div><dt className="text-xs text-gray-500">Lead</dt><dd>{activity.lead?.name ?? 'Sem lead'}</dd></div>
        <div><dt className="text-xs text-gray-500">Tipo</dt><dd>{typeLabel(activity.activity_type, types)}</dd></div>
        <div><dt className="text-xs text-gray-500">Prioridade</dt><dd>{PRIORITIES.find(item => item.value === activity.priority)?.label ?? activity.priority}</dd></div>
        {showResponsible && (
          <div><dt className="text-xs text-gray-500">Responsável</dt><dd>{responsible?.display_name ?? 'Sem responsável'}</dd></div>
        )}
        {activity.description && (
          <div><dt className="text-xs text-gray-500">Descrição</dt><dd className="whitespace-pre-wrap">{activity.description}</dd></div>
        )}
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        {activity.lead_id != null && (
          <button type="button" onClick={onChat} className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white">Abrir chat</button>
        )}
        <button type="button" onClick={onEdit} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800">Alterar</button>
        <button type="button" onClick={onComplete} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Finalizar</button>
      </div>
      {confirming && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm text-gray-700">
          <p>Finalizar esta tarefa?</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={onConfirmComplete} className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Confirmar</button>
            <button type="button" onClick={onCancelComplete} className="rounded-md border border-gray-200 px-3 py-1.5 text-sm">Cancelar</button>
          </div>
        </div>
      )}
    </aside>
  )
}

function typeLabel(value: string, types: CustomActivityType[]): string {
  return types.find(type => type.id === value)?.name
    ?? ACTIVITY_TYPES.find(type => type.value === value)?.label
    ?? value
}
