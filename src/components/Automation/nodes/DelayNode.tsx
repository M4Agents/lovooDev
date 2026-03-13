// =====================================================
// COMPONENT: DELAY NODE
// Data: 13/03/2026
// Objetivo: Nó de delay/espera para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Clock } from 'lucide-react'

const DelayNode = ({ data }: NodeProps) => {
  return (
    <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-lg shadow-lg border-2 border-orange-700 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-orange-700 !border-2 !border-white"
      />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Clock className="w-5 h-5 text-white" />
          <span className="text-xs font-semibold text-white uppercase tracking-wide">
            Aguardar
          </span>
        </div>
        <div className="text-white font-medium">{data.label}</div>
        {data.config?.description && (
          <div className="text-xs text-orange-100 mt-1">{data.config.description}</div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-orange-700 !border-2 !border-white"
      />
    </div>
  )
}

export default memo(DelayNode)
