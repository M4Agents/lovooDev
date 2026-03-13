// =====================================================
// COMPONENT: DELAY NODE
// Data: 13/03/2026
// Objetivo: Nó de delay/espera para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Clock, CheckCircle, AlertTriangle } from 'lucide-react'

const DelayNode = ({ data, selected }: NodeProps) => {
  const hasConfig = data.config?.duration && data.config?.unit
  const delayPreview = hasConfig
    ? `⏰ ${data.config.duration} ${data.config.unit === 'minutes' ? 'minuto(s)' : data.config.unit === 'hours' ? 'hora(s)' : 'dia(s)'}`
    : 'Clique para configurar tempo'
  
  return (
    <div className={`bg-white rounded-lg shadow-lg border-2 min-w-[280px] max-w-[320px] transition-all ${
      selected ? 'border-orange-600 ring-2 ring-orange-300' : 'border-gray-200 hover:border-orange-400'
    }`}>
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-orange-600 !border-2 !border-white"
      />
      
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-2 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-white" />
            <span className="text-xs font-semibold text-white uppercase tracking-wide">
              Aguardar
            </span>
          </div>
          {hasConfig ? (
            <CheckCircle className="w-4 h-4 text-green-300" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-yellow-300" />
          )}
        </div>
      </div>
      
      {/* Content Preview */}
      <div className="px-4 py-6 bg-gray-50">
        <div className="text-center">
          <div className="text-3xl mb-2">⏱️</div>
          <div className="text-lg font-semibold text-gray-700">
            {delayPreview}
          </div>
        </div>
      </div>
      
      {/* Stats */}
      {data.stats && (
        <div className="px-4 py-2 bg-blue-50 border-t border-gray-200 rounded-b-lg">
          <div className="flex items-center justify-center text-xs text-blue-700">
            <span>📊 Aguardando: {data.stats.waiting || 0}</span>
          </div>
        </div>
      )}
      
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-orange-600 !border-2 !border-white"
      />
    </div>
  )
}

export default memo(DelayNode)
