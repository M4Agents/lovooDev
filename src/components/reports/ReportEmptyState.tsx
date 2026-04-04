import React from 'react'
import { useTranslation } from 'react-i18next'
import { BarChart2 } from 'lucide-react'

interface ReportEmptyStateProps {
  title?: string
  description?: string
}

export const ReportEmptyState: React.FC<ReportEmptyStateProps> = ({
  title,
  description,
}) => {
  const { t } = useTranslation('reports')
  const displayTitle = title ?? t('empty.defaultTitle')
  const displayDescription = description ?? t('empty.defaultDescription')

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <BarChart2 className="w-7 h-7 text-gray-400" />
      </div>
      <p className="text-sm font-medium text-gray-700 mb-1">{displayTitle}</p>
      <p className="text-xs text-gray-400 max-w-xs">{displayDescription}</p>
    </div>
  )
}
