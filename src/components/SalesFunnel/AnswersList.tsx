import { useTranslation } from 'react-i18next'
import type { ContactAttemptAnswerDetail } from '../../types/contact-cycles'

interface AnswersListProps {
  answers: ContactAttemptAnswerDetail[]
}

export function AnswersList({ answers }: AnswersListProps) {
  const { t } = useTranslation('funnel')

  if (answers.length === 0) return null

  return (
    <div className="mt-2 pt-2 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
        {t('contactCycle.answersTitle')}
      </p>
      <ul className="space-y-1">
        {answers.map((a) => (
          <li key={a.question_id} className="text-xs text-gray-600">
            <span className="font-medium text-gray-700">{a.question_label}:</span>{' '}
            {a.value || '—'}
          </li>
        ))}
      </ul>
    </div>
  )
}
