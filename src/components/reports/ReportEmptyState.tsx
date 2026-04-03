import React from 'react'
import { BarChart2 } from 'lucide-react'

interface ReportEmptyStateProps {
  title?: string
  description?: string
}

export const ReportEmptyState: React.FC<ReportEmptyStateProps> = ({
  title = 'Sem dados para este período',
  description = 'Tente ampliar o período ou verificar os filtros selecionados.',
}) => (
  <div className="flex flex-col items-center justify-center py-16 text-center">
    <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
      <BarChart2 className="w-7 h-7 text-gray-400" />
    </div>
    <p className="text-sm font-medium text-gray-700 mb-1">{title}</p>
    <p className="text-xs text-gray-400 max-w-xs">{description}</p>
  </div>
)
