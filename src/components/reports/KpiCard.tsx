import React from 'react'
import { LucideIcon, AlertCircle } from 'lucide-react'

interface KpiCardProps {
  label: string
  value: string | number
  icon?: LucideIcon
  iconColor?: string
  subLabel?: React.ReactNode
  highlight?: boolean
  alert?: boolean
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  icon: Icon,
  iconColor = 'text-blue-500',
  subLabel,
  highlight = false,
  alert = false,
}) => (
  <div
    className={`bg-white rounded-xl border p-5 flex flex-col gap-2 ${
      highlight
        ? 'border-emerald-200 bg-emerald-50'
        : alert
        ? 'border-amber-200 bg-amber-50'
        : 'border-gray-200'
    }`}
  >
    <div className="flex items-center justify-between">
      <span className={`text-xs font-medium uppercase tracking-wide ${
        highlight ? 'text-emerald-600' : alert ? 'text-amber-600' : 'text-gray-500'
      }`}>
        {label}
      </span>
      {Icon && (
        <Icon className={`w-4 h-4 ${highlight ? 'text-emerald-500' : alert ? 'text-amber-500' : iconColor}`} />
      )}
      {alert && !Icon && <AlertCircle className="w-4 h-4 text-amber-500" />}
    </div>
    <p className={`text-2xl font-bold ${
      highlight ? 'text-emerald-700' : alert ? 'text-amber-700' : 'text-gray-900'
    }`}>
      {value}
    </p>
    {subLabel && (
      <p className={`text-xs ${
        highlight ? 'text-emerald-500' : alert ? 'text-amber-500' : 'text-gray-400'
      }`}>
        {subLabel}
      </p>
    )}
  </div>
)
