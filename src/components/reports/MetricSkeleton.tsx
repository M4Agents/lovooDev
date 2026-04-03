import React from 'react'

export const KpiSkeleton: React.FC = () => (
  <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
    <div className="h-3 w-24 bg-gray-200 rounded mb-3" />
    <div className="h-7 w-16 bg-gray-200 rounded mb-2" />
    <div className="h-2 w-20 bg-gray-100 rounded" />
  </div>
)

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
    <div className="h-12 bg-gray-50 border-b border-gray-200" />
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 last:border-0">
        <div className="h-3 w-32 bg-gray-200 rounded" />
        <div className="h-3 w-16 bg-gray-200 rounded ml-auto" />
        <div className="h-3 w-16 bg-gray-200 rounded" />
        <div className="h-3 w-16 bg-gray-200 rounded" />
      </div>
    ))}
  </div>
)

export const BarChartSkeleton: React.FC = () => (
  <div className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
    <div className="h-4 w-40 bg-gray-200 rounded mb-6" />
    <div className="space-y-3">
      {[80, 60, 90, 45, 70].map((w, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3 w-24 bg-gray-200 rounded" />
          <div className="h-6 bg-gray-200 rounded flex-1" style={{ maxWidth: `${w}%` }} />
        </div>
      ))}
    </div>
  </div>
)
