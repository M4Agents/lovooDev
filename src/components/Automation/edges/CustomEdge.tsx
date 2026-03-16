// =====================================================
// COMPONENT: CUSTOM EDGE
// Data: 13/03/2026
// Objetivo: Edge customizada com labels para o canvas
// FASE 7.5.2 - Labels nas Conexões
// =====================================================

import { memo } from 'react'
import { EdgeProps, getSmoothStepPath, EdgeLabelRenderer, useReactFlow } from 'reactflow'
import { X } from 'lucide-react'

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
  const { setEdges } = useReactFlow()
  
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
  
  // Função para deletar edge
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEdges((edges) => edges.filter((edge) => edge.id !== id))
  }
  
  return (
    <>
      {/* Path invisível - área clicável maior */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        className="react-flow__edge-interaction"
        style={{
          cursor: 'pointer'
        }}
      />
      
      {/* Path visual - linha tracejada fina */}
      <path
        id={id}
        className="react-flow__edge-path"
        d={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? '#3b82f6' : edgeColor,
          strokeWidth: selected ? 2 : 1,
          strokeDasharray: '5, 5',
          transition: 'stroke 0.2s, stroke-width 0.2s',
          pointerEvents: 'none'
        }}
      />
      
      {/* Botão de deletar - aparece quando edge está selecionado */}
      {selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <button
              onClick={handleDelete}
              className="bg-red-500 hover:bg-red-600 text-white rounded-full p-1.5 shadow-lg transition-colors"
              title="Deletar conexão"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </EdgeLabelRenderer>
      )}
      
      {/* Label da conexão (se existir e não estiver selecionado) */}
      {label && !selected && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div className="px-2 py-1 rounded text-xs font-semibold shadow-md bg-white text-gray-700 border border-gray-300">
              {label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(CustomEdge)
