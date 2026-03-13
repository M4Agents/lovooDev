// =====================================================
// COMPONENT: END NODE
// Data: 13/03/2026
// Objetivo: Nó de finalização para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { Flag } from 'lucide-react'

const EndNode = ({ data }: NodeProps) => {
  return (
    <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-lg shadow-lg border-2 border-red-700 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-red-700 !border-2 !border-white"
      />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Flag className="w-5 h-5 text-white" />
          <span className="text-xs font-semibold text-white uppercase tracking-wide">
            Fim
          </span>
        </div>
        <div className="text-white font-medium">{data.label}</div>
        {data.config?.description && (
          <div className="text-xs text-red-100 mt-1">{data.config.description}</div>
        )}
      </div>
    </div>
  )
}

export default memo(EndNode)
