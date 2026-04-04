import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar, ChevronDown, RefreshCw } from 'lucide-react'
import { PeriodFilter as PeriodFilterType, PeriodType, PREDEFINED_PERIODS } from '../types/analytics'

interface PeriodFilterProps {
  selectedPeriod: PeriodFilterType
  onPeriodChange: (period: PeriodFilterType) => void
  autoRefresh?: boolean
  onAutoRefreshToggle?: (enabled: boolean) => void
  className?: string
}

export const PeriodFilter: React.FC<PeriodFilterProps> = ({
  selectedPeriod,
  onPeriodChange,
  autoRefresh = false,
  onAutoRefreshToggle,
  className = '',
}) => {
  const { t } = useTranslation('periodFilter')
  const [isOpen, setIsOpen] = useState(false)
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  const periodLabel = useCallback(
    (type: PeriodType) => t(`periods.${type}`),
    [t]
  )

  const groupedPeriods = useMemo(
    () =>
      [
        {
          id: 'short',
          groupKey: 'groups.shortTerm' as const,
          keys: ['today', 'yesterday', '7days', '15days', '30days'] as PeriodType[],
        },
        {
          id: 'monthly',
          groupKey: 'groups.monthly' as const,
          keys: ['this_month', 'last_month'] as PeriodType[],
        },
        {
          id: 'long',
          groupKey: 'groups.longTerm' as const,
          keys: ['90days', 'this_quarter', 'this_year'] as PeriodType[],
        },
      ] as const,
    []
  )

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handlePredefinedPeriodSelect = (periodType: PeriodType) => {
    const now = new Date()
    let startDate: Date
    let endDate: Date = now

    switch (periodType) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
        break
      case 'yesterday': {
        const yesterday = new Date(now)
        yesterday.setDate(yesterday.getDate() - 1)
        startDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate())
        endDate = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59)
        break
      }
      case '7days':
        startDate = new Date(now)
        startDate.setDate(startDate.getDate() - 7)
        break
      case '30days':
        startDate = new Date(now)
        startDate.setDate(startDate.getDate() - 30)
        break
      case '15days':
        startDate = new Date(now)
        startDate.setDate(startDate.getDate() - 15)
        break
      case '90days':
        startDate = new Date(now)
        startDate.setDate(startDate.getDate() - 90)
        break
      case 'this_month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1)
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
        break
      case 'last_month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
        break
      case 'this_quarter': {
        const q = Math.floor(now.getMonth() / 3)
        startDate = new Date(now.getFullYear(), q * 3, 1)
        endDate = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59)
        break
      }
      case 'this_year':
        startDate = new Date(now.getFullYear(), 0, 1)
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59)
        break
      default:
        return
    }

    const base = PREDEFINED_PERIODS[periodType]
    const newPeriod: PeriodFilterType = {
      ...base,
      label: periodLabel(periodType),
      startDate,
      endDate,
    }

    onPeriodChange(newPeriod)
    setIsOpen(false)
  }

  const handleCustomPeriodApply = () => {
    if (!customStartDate || !customEndDate) return

    const startDate = new Date(customStartDate)
    const endDate = new Date(customEndDate)
    endDate.setHours(23, 59, 59)

    if (startDate > endDate) {
      alert(t('validation.startBeforeEnd'))
      return
    }

    const newPeriod: PeriodFilterType = {
      ...PREDEFINED_PERIODS.custom,
      label: periodLabel('custom'),
      startDate,
      endDate,
    }

    onPeriodChange(newPeriod)
    setIsOpen(false)
  }

  const formatDateForInput = (date: Date) => {
    return date.toISOString().split('T')[0]
  }

  useEffect(() => {
    if (selectedPeriod.type === 'custom' && selectedPeriod.startDate && selectedPeriod.endDate) {
      setCustomStartDate(formatDateForInput(selectedPeriod.startDate))
      setCustomEndDate(formatDateForInput(selectedPeriod.endDate))
    }
  }, [selectedPeriod])

  const triggerLabel = periodLabel(selectedPeriod.type)

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
        >
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">{triggerLabel}</span>
          <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
            <div className="p-2">
              <div className="space-y-3">
                {groupedPeriods.map((group) => (
                  <div key={group.id}>
                    <p className="px-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wide">
                      {t(group.groupKey)}
                    </p>
                    {group.keys.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => handlePredefinedPeriodSelect(key)}
                        className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors ${
                          selectedPeriod.type === key
                            ? 'bg-blue-50 text-blue-700 font-medium'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {periodLabel(key)}
                      </button>
                    ))}
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="text-sm font-medium text-gray-700 mb-2">{t('custom.title')}</div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1" htmlFor="period-filter-start">
                      {t('custom.startDate')}
                    </label>
                    <input
                      id="period-filter-start"
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder={t('custom.placeholder')}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1" htmlFor="period-filter-end">
                      {t('custom.endDate')}
                    </label>
                    <input
                      id="period-filter-end"
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder={t('custom.placeholder')}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleCustomPeriodApply}
                    disabled={!customStartDate || !customEndDate}
                    className="w-full py-2 px-4 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('custom.apply')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {onAutoRefreshToggle && (
        <button
          type="button"
          onClick={() => onAutoRefreshToggle(!autoRefresh)}
          className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${
            autoRefresh
              ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
              : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${autoRefresh ? 'animate-spin' : ''}`} />
          {t('autoRefresh')}
        </button>
      )}
    </div>
  )
}
