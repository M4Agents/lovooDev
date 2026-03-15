// =====================================================
// COMPONENT: CUSTOM EDGE
// Data: 13/03/2026
// Objetivo: Edge customizada com labels para o canvas
// FASE 7.5.2 - Labels nas Conexões
// =====================================================

import { memo } from 'react'
import { EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from 'reactflow'

const CustomEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected
}: EdgeProps) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 0, // Cantos retos 90° - estilo Datacraz
  })

  const label = data?.label || ''
  const edgeColor = data?.color || '#94a3b8' // gray-400 default
  
  return (
    <>
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#3b82f6' : edgeColor,
          strokeWidth: selected ? 2 : 1,
          strokeDasharray: '5, 5',
          transition: 'stroke 0.2s, stroke-width 0.2s'
        }}
      />
      
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div className={`px-2 py-1 rounded text-xs font-semibold shadow-md ${
              selected 
                ? 'bg-blue-500 text-white' 
                : 'bg-white text-gray-700 border border-gray-300'
            }`}>
              {label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(CustomEdge)
