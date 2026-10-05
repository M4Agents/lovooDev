import type { TaskCard, WindowMinutes } from '../../../utils/taskBoardContract'

interface Counts {
  open: number
  overdue: number
  due_today: number
  upcoming: number
}

interface Props {
  counts: Counts | null
  card: TaskCard
  windowMinutes: WindowMinutes
  onSelect: (card: TaskCard) => void
}

export function TaskBoardCards({ counts, card, windowMinutes, onSelect }: Props) {
  const items: { id: TaskCard; title: string; hint: string; value: number | null }[] = [
    { id: 'open', title: 'Abertas', hint: 'Inclui tarefas sem data', value: counts?.open ?? null },
    { id: 'overdue', title: 'Atrasadas', hint: 'Horário já passou', value: counts?.overdue ?? null },
    { id: 'due_today', title: 'A vencer hoje', hint: 'Ainda no prazo, hoje', value: counts?.due_today ?? null },
    { id: 'upcoming', title: 'Próximos minutos', hint: `Janela de ${windowMinutes} min, pode passar da meia-noite`, value: counts?.upcoming ?? null },
  ]

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          className={[
            'rounded-xl border px-4 py-3 text-left transition-colors',
            card === item.id ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-300',
          ].join(' ')}
        >
          <p className="text-sm font-semibold text-gray-900">{item.title}</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{item.value ?? '—'}</p>
          <p className="mt-1 text-xs text-gray-500">{item.hint}</p>
        </button>
      ))}
    </div>
  )
}
