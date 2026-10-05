import type { CustomActivityType } from '../../../types/calendar'
import { PRIORITIES } from '../../../types/calendar'
import type { DashboardUser } from '../../../types/dashboard'
import type { DateMode, TaskScope, WindowMinutes } from '../../../utils/taskBoardContract'
import type { TaskBoardControls } from '../../../hooks/dashboard/useTaskBoard'

const DATE_OPTIONS: { id: DateMode; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'today', label: 'Hoje' },
  { id: 'tomorrow', label: 'Amanhã' },
  { id: 'range', label: 'Período específico' },
  { id: 'undated', label: 'Sem data' },
]

interface Props {
  controls: TaskBoardControls
  scope: TaskScope | null
  users: DashboardUser[]
  types: CustomActivityType[]
  onChange: (partial: Partial<TaskBoardControls>) => void
}

export function TaskBoardFilters({ controls, scope, users, types, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {DATE_OPTIONS.map(option => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange({ date: option.id })}
            className={chip(controls.date === option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {controls.date === 'range' && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            De
            <input
              type="date"
              value={controls.from}
              onChange={event => onChange({ from: event.target.value })}
              className="mt-1 block rounded-md border border-gray-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-gray-600">
            Até
            <input
              type="date"
              value={controls.to}
              onChange={event => onChange({ to: event.target.value })}
              className="mt-1 block rounded-md border border-gray-200 px-2 py-1.5 text-sm"
            />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={controls.q}
          onChange={event => onChange({ q: event.target.value })}
          placeholder="Buscar por título ou lead"
          className="min-w-[220px] flex-1 rounded-md border border-gray-200 px-3 py-2 text-sm"
        />
        <select
          value={controls.activityType}
          onChange={event => onChange({ activityType: event.target.value })}
          className="rounded-md border border-gray-200 px-2 py-2 text-sm"
        >
          <option value="">Todos os tipos</option>
          {types.map(type => (
            <option key={type.id} value={type.id}>{type.name}</option>
          ))}
        </select>
        <select
          value={controls.priority}
          onChange={event => onChange({ priority: event.target.value })}
          className="rounded-md border border-gray-200 px-2 py-2 text-sm"
        >
          <option value="">Todas as prioridades</option>
          {PRIORITIES.map(item => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        {scope === 'company' && (
          <select
            value={controls.userId}
            onChange={event => onChange({ userId: event.target.value })}
            className="rounded-md border border-gray-200 px-2 py-2 text-sm"
          >
            <option value="">Todos os responsáveis</option>
            {users.map(user => (
              <option key={user.user_id} value={user.user_id}>{user.display_name}</option>
            ))}
          </select>
        )}
        <select
          value={String(controls.windowMinutes)}
          onChange={event => onChange({ windowMinutes: Number(event.target.value) as WindowMinutes })}
          className="rounded-md border border-gray-200 px-2 py-2 text-sm"
          title="Janela de Próximos minutos"
        >
          <option value="15">Próximos 15 min</option>
          <option value="30">Próximos 30 min</option>
          <option value="60">Próximos 60 min</option>
        </select>
      </div>
    </div>
  )
}

function chip(active: boolean): string {
  return [
    'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
    active ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50',
  ].join(' ')
}
