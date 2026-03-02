import React from 'react';
import { CompanyGrowth, PlanDistribution } from '../types/analytics';

interface SimpleBarChartProps {
  data: CompanyGrowth[];
  title: string;
  height?: number;
}

export const SimpleBarChart: React.FC<SimpleBarChartProps> = ({ 
  data, 
  title, 
  height = 200 
}) => {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="flex items-center justify-center h-48 text-gray-500">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-lg flex items-center justify-center">
              📊
            </div>
            <p className="text-sm">Nenhum dado disponível para o período</p>
          </div>
        </div>
      </div>
    );
  }

  const maxValue = Math.max(...data.map(d => d.count));
  const maxHeight = height - 60; // Reserve space for labels

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      
      <div className="relative" style={{ height: `${height}px` }}>
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-xs text-gray-500 pr-2">
          <span>{maxValue}</span>
          <span>{Math.round(maxValue * 0.75)}</span>
          <span>{Math.round(maxValue * 0.5)}</span>
          <span>{Math.round(maxValue * 0.25)}</span>
          <span>0</span>
        </div>

        {/* Chart area */}
        <div className="ml-8 h-full flex items-end justify-between gap-1">
          {data.map((item) => {
            const barHeight = maxValue > 0 ? (item.count / maxValue) * maxHeight : 0;
            const date = new Date(item.date);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            
            return (
              <div key={item.date} className="flex flex-col items-center group relative">
                {/* Bar */}
                <div
                  className={`w-6 bg-gradient-to-t from-blue-500 to-blue-400 rounded-t-sm transition-all duration-200 group-hover:from-blue-600 group-hover:to-blue-500 ${
                    item.count === 0 ? 'opacity-30' : ''
                  }`}
                  style={{ height: `${barHeight}px` }}
                />
                
                {/* Date label */}
                <div className={`mt-2 text-xs text-center ${isWeekend ? 'text-gray-400' : 'text-gray-600'}`}>
                  <div>{date.getDate()}</div>
                  <div className="text-[10px]">
                    {date.toLocaleDateString('pt-BR', { month: 'short' })}
                  </div>
                </div>

                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                  <div>{item.count} empresas</div>
                  <div>{date.toLocaleDateString('pt-BR')}</div>
                  <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface SimplePieChartProps {
  data: PlanDistribution[];
  title: string;
}

export const SimplePieChart: React.FC<SimplePieChartProps> = ({ data, title }) => {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="flex items-center justify-center h-48 text-gray-500">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-lg flex items-center justify-center">
              🥧
            </div>
            <p className="text-sm">Nenhum plano encontrado</p>
          </div>
        </div>
      </div>
    );
  }

  const total = data.reduce((sum, item) => sum + item.count, 0);
  let currentAngle = 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      
      <div className="flex items-center gap-6">
        {/* Pie Chart */}
        <div className="relative">
          <svg width="120" height="120" className="transform -rotate-90">
            <circle
              cx="60"
              cy="60"
              r="50"
              fill="none"
              stroke="#f3f4f6"
              strokeWidth="20"
            />
            {data.map((item) => {
              const percentage = (item.count / total) * 100;
              const strokeDasharray = `${(percentage / 100) * 314} 314`; // 2 * π * 50 ≈ 314
              const strokeDashoffset = -currentAngle * 3.14; // Convert angle to offset
              
              currentAngle += percentage * 3.6; // 360 degrees / 100 percent = 3.6
              
              return (
                <circle
                  key={item.plan}
                  cx="60"
                  cy="60"
                  r="50"
                  fill="none"
                  stroke={item.color}
                  strokeWidth="20"
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  className="transition-all duration-300"
                />
              );
            })}
          </svg>
          
          {/* Center text */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <div className="text-lg font-bold text-gray-900">{total}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 space-y-2">
          {data.map((item) => (
            <div key={item.plan} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-sm font-medium text-gray-700 capitalize">
                  {item.plan}
                </span>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-gray-900">
                  {item.count}
                </div>
                <div className="text-xs text-gray-500">
                  {item.percentage}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
