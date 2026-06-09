// =====================================================
// COMPONENT: KEYWORD ROUTER NODE
// Exibe um nó de roteamento por palavras-chave no canvas.
// Cada regra configura um handle de saída estável.
// O handle "default" é sempre exibido por último.
// =====================================================

import { memo } from 'react'
import { Handle, Position, NodeProps, useEdges, useReactFlow } from 'reactflow'
import { Filter, AlertTriangle } from 'lucide-react'
import NodeToolbar from './NodeToolbar'
import NodeDebugBadge from './NodeDebugBadge'
import type { KeywordRouterRule } from '../../../types/automation'

const KeywordRouterNode = ({ data, selected, id }: NodeProps) => {
  const { setNodes, setEdges } = useReactFlow()
  const allEdges = useEdges()

  const rules: KeywordRouterRule[] = Array.isArray(data.config?.rules)
    ? data.config.rules
    : []

  const hasRules = rules.length > 0

  const isHandleConnected = (handle: string) =>
    allEdges.some((e) => e.source === id && e.sourceHandle === handle)

  const handleDelete = () => {
    setNodes((nodes) => nodes.filter((n) => n.id !== id))
    setEdges((edges) => edges.filter((e) => e.source !== id && e.target !== id))
  }

  const handleDuplicate = () => {
    setNodes((nodes) => {
      const original = nodes.find((n) => n.id === id)
      if (!original) return nodes
      return [
        ...nodes,
        {
          ...original,
          id: `keyword_router-${Date.now()}`,
          position: { x: original.position.x + 50, y: original.position.y + 50 },
          selected: false,
        },
      ]
    })
  }

  const handleOpen = () => {
    if (data.onSelect) data.onSelect()
  }

  return (
    <div
      className={`bg-white rounded shadow-sm border-2 transition-all overflow-visible relative ${
        selected
          ? 'border-purple-600 ring-2 ring-purple-300'
          : 'border-gray-200 hover:border-purple-400'
      }`}
      style={{ minWidth: 160 }}
    >
      <NodeDebugBadge debugStatus={data.debugStatus} />

      {selected && (
        <NodeToolbar
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onOpen={handleOpen}
        />
      )}

      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-2 py-1 rounded-t relative">
        {/* Handle de entrada */}
        <Handle
          type="target"
          position={Position.Left}
          className="absolute -left-1 w-2 h-2 rounded-full !bg-purple-600 !border-2 !border-white"
          style={{ top: '50%', transform: 'translateY(-50%)' }}
        />
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <Filter className="w-2.5 h-2.5 text-white" />
            <span className="text-[9px] font-semibold text-white uppercase tracking-wide">
              Roteador
            </span>
          </div>
          {!hasRules && (
            <AlertTriangle className="w-2.5 h-2.5 text-yellow-300" />
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="px-2 py-1.5 bg-gray-50 border-b border-gray-100">
        <div className="text-[8px] text-gray-500 leading-tight">
          {hasRules
            ? `${rules.length} regra${rules.length !== 1 ? 's' : ''} configurada${rules.length !== 1 ? 's' : ''}`
            : 'Clique para configurar'}
        </div>
      </div>

      {/* Regras com handles */}
      <div className="py-1 space-y-0.5 overflow-visible relative">
        {rules.map((rule) => {
          const connected = isHandleConnected(rule.handle)
          return (
            <div
              key={rule.id}
              className="flex items-center justify-between px-2 pr-4 py-0.5 relative"
              style={{ minHeight: 18 }}
            >
              <div className="flex items-center gap-1 min-w-0">
                {!connected && (
                  <span className="text-[7px] text-amber-500" title="Sem conexão">⚠</span>
                )}
                <span
                  className="text-[8px] text-gray-700 truncate"
                  style={{ maxWidth: 100 }}
                  title={rule.label || rule.keywords?.join(', ')}
                >
                  {rule.label || rule.keywords?.[0] || '(sem label)'}
                </span>
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={rule.handle}
                className="absolute -right-1 w-2 h-2 rounded-full !bg-purple-500 !border-2 !border-white"
                style={{ top: '50%', transform: 'translateY(-50%)' }}
              />
            </div>
          )
        })}

        {/* Ramo padrão */}
        <div
          className="flex items-center justify-between px-2 pr-4 py-0.5 border-t border-gray-100 mt-0.5 relative"
          style={{ minHeight: 18 }}
        >
          <div className="flex items-center gap-1">
            {!isHandleConnected('default') && (
              <span className="text-[7px] text-gray-400" title="Sem conexão">⚠</span>
            )}
            <span className="text-[8px] text-gray-400 italic">Padrão</span>
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="default"
            className="absolute -right-1 w-2 h-2 rounded-full !bg-gray-400 !border-2 !border-white"
            style={{ top: '50%', transform: 'translateY(-50%)' }}
          />
        </div>
      </div>
    </div>
  )
}

export default memo(KeywordRouterNode)
