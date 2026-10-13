import { TASKLESS_LIST_LIMIT } from '../../../utils/tasklessLeadAccess'
import { PREDEFINED_PERIODS } from '../../../types/analytics'
import type { DashboardUser } from '../../../types/dashboard'
import type { TasklessLeadList } from '../../../services/tasklessLeadsApi'

interface Props {
  data: TasklessLeadList | null
  loading: boolean
  error: string | null
  canConfigure: boolean
  users: DashboardUser[]
  onConfigure: () => void
  onOpen: (leadId: number) => void
  onRetry: () => void
}

function formatCivil(date: string): string {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) return date
  return `${day}/${month}/${year}`
}

function periodLabel(data: TasklessLeadList): string {
  if (data.period_type === 'custom' && data.custom_start && data.custom_end) {
    return `${formatCivil(data.custom_start)} – ${formatCivil(data.custom_end)}`
  }
  return PREDEFINED_PERIODS[data.period_type]?.label ?? 'Últimos 30 dias'
}

function formatWhen(iso: string | null, timezone: string): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function TasklessLeadsColumn({
  data, loading, error, canConfigure, users, onConfigure, onOpen, onRetry,
}: Props) {
  const timezone = data?.timezone ?? 'America/Sao_Paulo'
  const showResponsible = data?.scope === 'company'

  return (
    <section className="flex min-h-64 flex-col rounded-xl border border-gray-200 bg-white">
      <header className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Leads sem tarefas</h2>
          {data && (
            <p className="text-xs text-gray-500">
              {periodLabel(data)}
              {data.configured ? ` · ${data.total} ${data.total === 1 ? 'posição' : 'posições'}` : ''}
            </p>
          )}
        </div>
        {canConfigure && (
          <button type="button" onClick={onConfigure} className="text-xs font-medium text-indigo-700 hover:underline">
            Configurações
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && !data && <p className="px-4 py-6 text-sm text-gray-500">Carregando...</p>}
        {error && (
          <div className="px-4 py-4 text-sm text-red-700">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className="mt-2 font-medium underline">Tentar de novo</button>
          </div>
        )}
        {!error && data && !data.configured && (
          <p className="px-4 py-6 text-sm text-gray-500">
            Nenhuma etapa foi escolhida. Abra Configurações para definir quais etapas entram nesta lista.
          </p>
        )}
        {data && data.truncated && (
          <p className="px-4 pt-3 text-xs font-medium text-amber-800">
            Exibindo {Math.min(data.items.length, TASKLESS_LIST_LIMIT)} de {data.total} posições.
          </p>
        )}
        {data && data.configured && data.items.length === 0 && !loading && !error && (
          <p className="px-4 py-6 text-sm text-gray-500">Nenhum lead sem tarefa nas etapas escolhidas neste período.</p>
        )}
        <ul className="divide-y divide-gray-100">
          {data?.items.map(item => {
            const entered = formatWhen(item.entered_stage_at, timezone)
            const completed = formatWhen(item.last_completed_at, timezone)
            const responsible = users.find(user => user.user_id === item.responsible_user_id)
            return (
              <li key={item.position_id}>
                <button
                  type="button"
                  onClick={() => onOpen(item.lead_id)}
                  className="w-full px-4 py-3 text-left hover:bg-gray-50"
                >
                  <p className="text-sm font-medium text-gray-900">{item.lead_name}</p>
                  <p className="mt-0.5 text-xs text-gray-600">{item.funnel_name} · {item.stage_name}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {entered ? `Na etapa desde ${entered}` : 'Sem data de entrada na etapa'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {completed ? `Última tarefa concluída em ${completed}` : 'Nunca teve tarefa concluída'}
                  </p>
                  {showResponsible && (
                    <p className="mt-1 text-xs text-gray-500">{responsible?.display_name ?? 'Sem responsável'}</p>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
