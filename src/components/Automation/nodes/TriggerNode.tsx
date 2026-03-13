// =====================================================
// COMPONENT: TRIGGER NODE
// Data: 13/03/2026
// Objetivo: Nó de gatilho para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Zap } from 'lucide-react'

const TriggerNode = ({ data }: NodeProps) => {
  return (
    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg border-2 border-green-700 min-w-[200px]">
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="w-5 h-5 text-white" />
          <span className="text-xs font-semibold text-white uppercase tracking-wide">
            Gatilho
          </span>
        </div>
        <div className="text-white font-medium">{data.label}</div>
        {data.config?.description && (
          <div className="text-xs text-green-100 mt-1">{data.config.description}</div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="w-3 h-3 !bg-green-700 !border-2 !border-white"
      />
    </div>
  )
}

export default memo(TriggerNode)
