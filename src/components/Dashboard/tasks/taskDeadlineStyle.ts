import type { TaskCard, TaskDeadlineTone } from '../../../utils/taskBoardContract'

export function deadlineBarClass(tone: TaskDeadlineTone): string {
  if (tone === 'overdue') return 'border-l-red-500'
  if (tone === 'due') return 'border-l-amber-400'
  if (tone === 'on_time') return 'border-l-green-500'
  return 'border-l-gray-300'
}

export function deadlineBadgeClass(tone: TaskDeadlineTone): string {
  if (tone === 'overdue') return 'border-red-200 bg-red-50 text-red-700'
  if (tone === 'due') return 'border-amber-200 bg-amber-50 text-amber-800'
  if (tone === 'on_time') return 'border-green-200 bg-green-50 text-green-700'
  return 'border-gray-200 bg-gray-50 text-gray-600'
}

export function cardChrome(card: TaskCard, selected: boolean): string {
  if (card === 'overdue') {
    return selected ? 'border-red-600 bg-red-50' : 'border-red-200 bg-white hover:border-red-300'
  }
  if (card === 'due_today' || card === 'upcoming') {
    return selected ? 'border-amber-500 bg-amber-50' : 'border-amber-200 bg-white hover:border-amber-300'
  }
  return selected ? 'border-gray-500 bg-gray-50' : 'border-gray-200 bg-white hover:border-gray-300'
}

export function cardStripeClass(card: TaskCard): string {
  if (card === 'overdue') return 'bg-red-500'
  if (card === 'due_today' || card === 'upcoming') return 'bg-amber-400'
  return 'bg-gray-300'
}

export function cardCountClass(card: TaskCard): string {
  if (card === 'overdue') return 'text-red-700'
  if (card === 'due_today' || card === 'upcoming') return 'text-amber-700'
  return 'text-gray-700'
}
