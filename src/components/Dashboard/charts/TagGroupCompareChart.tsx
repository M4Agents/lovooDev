import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

export interface TagGroupChartPoint {
  name: string
  value: number | null
}

interface Props {
  data: TagGroupChartPoint[]
  valueLabel: string
  formatValue: (value: number) => string
  height?: number
}

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6']

function formatTick(value: string): string {
  return value.length > 18 ? `${value.slice(0, 18)}…` : value
}

export function TagGroupCompareChart({ data, valueLabel, formatValue, height = 220 }: Props) {
  if (data.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart layout="vertical" data={data} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,.06)" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fontSize: 11, fill: '#374151' }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatTick}
        />
        <Tooltip
          cursor={{ fill: 'rgba(0,0,0,.04)' }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const item = payload[0]
            const raw = item.value
            return (
              <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
                <p className="font-semibold text-gray-700 mb-1">{item.payload?.name}</p>
                <p className="text-gray-500">
                  {valueLabel}: <span className="font-bold text-gray-800">
                    {raw == null || Number.isNaN(Number(raw)) ? '—' : formatValue(Number(raw))}
                  </span>
                </p>
              </div>
            )
          }}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={18}>
          {data.map((_, index) => (
            <Cell key={index} fill={COLORS[index % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
