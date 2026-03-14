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
  EdgeTypes,
  Panel,
  ReactFlowProvider
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Save, Play, Pause, Trash2, Plus } from 'lucide-react'

// Custom Node Components
import TriggerNode from './nodes/TriggerNode'
import ActionNode from './nodes/ActionNode'
import ConditionNode from './nodes/ConditionNode'
import MessageNode from './nodes/MessageNode'
import DelayNode from './nodes/DelayNode'
import EndNode from './nodes/EndNode'

// Custom Edge Component
import CustomEdge from './edges/CustomEdge'

// Add Trigger Modal
import AddTriggerModal from './AddTriggerModal'

interface FlowCanvasProps {
  flowId: string
  initialNodes?: Node[]
  initialEdges?: Edge[]
  isActive: boolean
  onSave: (nodes: Node[], edges: Edge[]) => Promise<void>
  onToggleActive: (isActive: boolean) => Promise<void>
  onDelete: () => Promise<void>
  selectedNode: Node | null
  onNodeSelect: (node: Node | null) => void
  onNodeConfigSave: (nodeId: string, config: any) => void
}

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  message: MessageNode,
  delay: DelayNode,
  end: EndNode
}

const edgeTypes: EdgeTypes = {
  custom: CustomEdge
}

function FlowCanvasInner({
  flowId,
  initialNodes = [],
  initialEdges = [],
  isActive,
  onSave,
  onToggleActive,
  onDelete,
  selectedNode,
  onNodeSelect,
  onNodeConfigSave
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [isSaving, setIsSaving] = useState(false)
  const [isAddTriggerModalOpen, setIsAddTriggerModalOpen] = useState(false)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)

  const onConnect = useCallback(
    (params: Connection) => {
      // Adicionar label baseado no tipo de conexão
      let label = ''
      let color = '#94a3b8' // gray-400
      
      // Se vem de uma condição
      if (params.sourceHandle === 'true') {
        label = '✓ Sim'
        color = '#16a34a' // green-600
      } else if (params.sourceHandle === 'false') {
        label = '✗ Não'
        color = '#dc2626' // red-600
      } else if (params.sourceHandle?.startsWith('button-')) {
        // Se vem de um botão de mensagem
        const buttonIndex = parseInt(params.sourceHandle.replace('button-', ''))
        label = `Opção ${buttonIndex + 1}`
        color = '#9333ea' // purple-600
      }
      
      const newEdge = {
        ...params,
        type: 'custom',
        data: { label, color }
      }
      
      setEdges((eds) => addEdge(newEdge, eds))
    },
    [setEdges]
  )

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeSelect(node)
    },
    [onNodeSelect]
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()

      const reactFlowBounds = reactFlowWrapper.current?.getBoundingClientRect()
      const data = event.dataTransfer.getData('application/reactflow')

      if (!data || !reactFlowBounds || !reactFlowInstance) return

      const blockData = JSON.parse(data)
      const position = reactFlowInstance.project({
        x: event.clientX - reactFlowBounds.left,
        y: event.clientY - reactFlowBounds.top
      })

      const newNode: Node = {
        id: `${blockData.type}-${Date.now()}`,
        type: blockData.type,
        position,
        data: {
          label: blockData.label,
          config: {}
        }
      }

      setNodes((nds) => nds.concat(newNode))
    },
    [reactFlowInstance, setNodes]
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

  const handleAddTrigger = (triggerType: string, triggerLabel: string) => {
    // Criar novo nó de gatilho no centro do canvas
    const newNode: Node = {
      id: `trigger-${Date.now()}`,
      type: 'trigger',
      position: { x: 250, y: 100 },
      data: {
        label: triggerLabel,
        config: {
          triggerType: triggerType
        }
      }
    }

    setNodes((nds) => nds.concat(newNode))
  }

  return (
    <div className="w-full h-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
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

        {/* Empty State - Botão Adicionar Gatilho */}
        {nodes.length === 0 && (
          <Panel position="center">
            <div className="flex flex-col items-center justify-center p-8 bg-white rounded-lg shadow-lg border-2 border-dashed border-gray-300">
              <div className="text-center mb-6">
                <div className="text-4xl mb-3">⚡</div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Início
                </h3>
                <p className="text-sm text-gray-500 max-w-xs">
                  O gatilho é responsável por acionar a automação. Clique para adicionar um gatilho.
                </p>
              </div>
              <button
                onClick={() => setIsAddTriggerModalOpen(true)}
                className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md font-medium"
              >
                <Plus className="w-5 h-5 mr-2" />
                Adicionar gatilho
              </button>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Modal Adicionar Gatilho */}
      <AddTriggerModal
        isOpen={isAddTriggerModalOpen}
        onClose={() => setIsAddTriggerModalOpen(false)}
        onSelectTrigger={handleAddTrigger}
      />
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
