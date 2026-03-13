// =====================================================
// COMPONENT: FLOW CANVAS
// Data: 13/03/2026
// Objetivo: Canvas visual para edição de fluxos com React Flow
// =====================================================

import { useCallback, useState, useRef } from 'react'
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  NodeTypes,
  Panel,
  ReactFlowProvider
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Save, Play, Pause, Trash2 } from 'lucide-react'

// Custom Node Components
import TriggerNode from './nodes/TriggerNode'
import ActionNode from './nodes/ActionNode'
import ConditionNode from './nodes/ConditionNode'
import MessageNode from './nodes/MessageNode'
import DelayNode from './nodes/DelayNode'
import EndNode from './nodes/EndNode'

interface FlowCanvasProps {
  flowId: string
  initialNodes?: Node[]
  initialEdges?: Edge[]
  isActive: boolean
  onSave: (nodes: Node[], edges: Edge[]) => Promise<void>
  onToggleActive: (isActive: boolean) => Promise<void>
  onDelete: () => Promise<void>
}

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  message: MessageNode,
  delay: DelayNode,
  end: EndNode
}

function FlowCanvasInner({
  flowId,
  initialNodes = [],
  initialEdges = [],
  isActive,
  onSave,
  onToggleActive,
  onDelete
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [isSaving, setIsSaving] = useState(false)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  const handleSave = async () => {
    try {
      setIsSaving(true)
      await onSave(nodes, edges)
    } catch (error) {
      console.error('Erro ao salvar fluxo:', error)
      alert('Erro ao salvar fluxo')
    } finally {
      setIsSaving(false)
    }
  }

  const handleToggleActive = async () => {
    try {
      await onToggleActive(!isActive)
    } catch (error) {
      console.error('Erro ao alterar status:', error)
      alert('Erro ao alterar status do fluxo')
    }
  }

  const handleDelete = async () => {
    if (!confirm('Tem certeza que deseja deletar este fluxo?')) return

    try {
      await onDelete()
    } catch (error) {
      console.error('Erro ao deletar fluxo:', error)
      alert('Erro ao deletar fluxo')
    }
  }

  return (
    <div className="w-full h-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-left"
      >
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
          className="bg-white border border-gray-300 rounded"
        />

        {/* Toolbar */}
        <Panel position="top-right" className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Salvando...' : 'Salvar'}
          </button>

          <button
            onClick={handleToggleActive}
            className={`inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
              isActive
                ? 'bg-yellow-600 hover:bg-yellow-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {isActive ? (
              <>
                <Pause className="w-4 h-4 mr-2" />
                Desativar
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Ativar
              </>
            )}
          </button>

          <button
            onClick={handleDelete}
            className="inline-flex items-center px-3 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Deletar
          </button>
        </Panel>

        {/* Status Badge */}
        <Panel position="top-left">
          <div
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              isActive
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-800'
            }`}
          >
            {isActive ? '✓ Ativo' : '○ Inativo'}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  )
}

export default function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
