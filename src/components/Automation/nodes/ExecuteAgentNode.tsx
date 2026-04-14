import React from 'react'
import { Handle, Position, NodeProps, useReactFlow } from 'reactflow'
import { Bot, CheckCircle, AlertTriangle } from 'lucide-react'
import NodeToolbar from './NodeToolbar'
import NodeDebugBadge from './NodeDebugBadge'

export default function ExecuteAgentNode({ data, selected, id }: NodeProps) {
  const { setNodes, setEdges } = useReactFlow()
  const config = data.config || {}

  const handleDelete = () => {
    setNodes((nodes) => nodes.filter((n) => n.id !== id))
    setEdges((edges) => edges.filter((e) => e.source !== id && e.target !== id))
  }

  const handleDuplicate = () => {
    setNodes((nodes) => {
      const node = nodes.find((n) => n.id === id)
      if (!node) return nodes
      return [
        ...nodes,
        {
          ...node,
          id: `${node.type}-${Date.now()}`,
          position: { x: node.position.x + 50, y: node.position.y + 50 },
          selected: false,
        },
      ]
    })
  }

  const handleOpen = () => {
    if (data.onSelect) data.onSelect()
  }

  const hasConfig = !!(
    config.agentId &&
    config.promptTemplate?.trim() &&
    config.saveToVariable?.trim()
  )

  const agentLabel = config.agentName || (config.agentId ? config.agentId.slice(0, 8) + '…' : null)

  const promptPreview = config.promptTemplate?.trim()
    ? config.promptTemplate.trim().slice(0, 55) + (config.promptTemplate.trim().length > 55 ? '…' : '')
    : null

  return (
    <div
      className={`
        bg-white rounded shadow-sm border-2 w-36 transition-all overflow-visible relative
        ${selected ? 'border-violet-500 ring-2 ring-violet-300' : 'border-gray-200 hover:border-violet-400'}
      `}
    >
      <NodeDebugBadge debugStatus={data.debugStatus} />

      {selected && (
        <NodeToolbar
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onOpen={handleOpen}
        />
      )}

      <Handle
        type="target"
        position={Position.Left}
        className="absolute -left-1 w-2 h-2 rounded-full !bg-violet-500 !border-2 !border-white"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      />

      {/* Header */}
      <div className="bg-gradient-to-r from-violet-500 to-violet-600 px-2 py-1 rounded-t relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Bot className="w-2.5 h-2.5 text-white" />
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">
              Agente IA
            </span>
          </div>
          {hasConfig ? (
            <CheckCircle className="w-2.5 h-2.5 text-green-300" />
          ) : (
            <AlertTriangle className="w-2.5 h-2.5 text-yellow-300" />
          )}
        </div>
      </div>

      {/* Content preview */}
      <div className="px-2 py-1.5 bg-gray-50 space-y-0.5">
        {agentLabel ? (
          <div className="text-[8px] text-gray-800 leading-tight font-medium truncate">
            {agentLabel}
          </div>
        ) : (
          <div className="text-[8px] text-gray-400 leading-tight italic">
            Clique para configurar
          </div>
        )}

        {config.saveToVariable && (
          <div className="text-[7px] text-violet-600 leading-tight font-mono">
            {'→ {{' + config.saveToVariable + '}}'}
          </div>
        )}

        {promptPreview && (
          <div className="text-[7px] text-gray-400 leading-tight italic">
            {promptPreview}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="absolute -right-1 w-2 h-2 rounded-full !bg-violet-500 !border-2 !border-white"
        style={{ top: '50%', transform: 'translateY(-50%)' }}
      />
    </div>
  )
}
