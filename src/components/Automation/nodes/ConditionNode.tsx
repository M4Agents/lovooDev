// =====================================================
// COMPONENT: CONDITION NODE
// Data: 13/03/2026
// Objetivo: Nó de condição para o canvas
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps } from 'reactflow'
import { GitBranch } from 'lucide-react'

const ConditionNode = ({ data }: NodeProps) => {
  return (
    <div className="bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-lg shadow-lg border-2 border-yellow-700 min-w-[200px]">
      <Handle
        type="target"
        position={Position.Top}
        className="w-3 h-3 !bg-yellow-700 !border-2 !border-white"
      />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <GitBranch className="w-5 h-5 text-white" />
          <span className="text-xs font-semibold text-white uppercase tracking-wide">
            Condição
          </span>
        </div>
        <div className="text-white font-medium">{data.label}</div>
        {data.config?.description && (
          <div className="text-xs text-yellow-100 mt-1">{data.config.description}</div>
        )}
      </div>
      <div className="flex justify-between px-4 pb-2">
        <Handle
          type="source"
          position={Position.Bottom}
          id="true"
          className="w-3 h-3 !bg-green-600 !border-2 !border-white relative !left-[-20px]"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="false"
          className="w-3 h-3 !bg-red-600 !border-2 !border-white relative !right-[-20px]"
        />
      </div>
    </div>
  )
}

export default memo(ConditionNode)
