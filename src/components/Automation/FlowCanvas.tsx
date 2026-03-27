// =====================================================
// COMPONENT: FLOW CANVAS
// Data: 13/03/2026
// Objetivo: Canvas visual para edição de fluxos com React Flow
// =====================================================

import { useCallback, useState, useRef, useEffect } from 'react'
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
import { Save, Play, Pause, Trash2 } from 'lucide-react'

// Custom Node Components
import StartNode from './nodes/StartNode'
import TriggerNode from './nodes/TriggerNode'
import ActionNode from './nodes/ActionNode'
import ConditionNode from './nodes/ConditionNode'
import MessageNode from './nodes/MessageNode'
import DelayNode from './nodes/DelayNode'
import EndNode from './nodes/EndNode'
import DistributionNode from './nodes/DistributionNode'

// Custom Edge Component
import CustomEdge from './edges/CustomEdge'

// Add Trigger Modal
import AddTriggerModal from './AddTriggerModal'

// Action Menu
import ActionMenu from './ActionMenu'

// Message Config Modal
import MessageConfigModal from './MessageConfigModal'

// Trigger Selector Modal
import TriggerSelectorModal from './TriggerSelectorModal'

// Trigger Config Modal
import TriggerConfigModal from './TriggerConfigModal'

import type { TriggerConfig } from '../../types/automation'

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
  onNodeConfigSave: (nodeId: string, config: any, currentNodes?: Node[]) => void
  onNodesUpdate?: (nodes: Node[]) => void
}

const nodeTypes: NodeTypes = {
  start: StartNode,
  trigger: TriggerNode,
  action: ActionNode,
  condition: ConditionNode,
  message: MessageNode,
  delay: DelayNode,
  end: EndNode,
  distribution: DistributionNode
}

const edgeTypes: EdgeTypes = {
  custom: CustomEdge
}

function FlowCanvasInner({
  initialNodes = [],
  initialEdges = [],
  isActive,
  onSave,
  onToggleActive,
  onDelete,
  onNodeSelect,
  onNodesUpdate
}: FlowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  
  // ✅ FIX: Sincronizar nodes com FlowEditor em tempo real
  useEffect(() => {
    if (onNodesUpdate) {
      console.log('🔄 [FlowCanvas] Nodes mudaram, notificando FlowEditor:', nodes.length)
      onNodesUpdate(nodes)
    }
  }, [nodes, onNodesUpdate])
  const [isSaving, setIsSaving] = useState(false)
  const [isAddTriggerModalOpen, setIsAddTriggerModalOpen] = useState(false)
  const [isTriggerSelectorOpen, setIsTriggerSelectorOpen] = useState(false)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const [actionMenuPosition, setActionMenuPosition] = useState<{ x: number; y: number } | undefined>()
   const [flowTriggers, setFlowTriggers] = useState<TriggerConfig[]>([])
  const [triggerOperator, setTriggerOperator] = useState<'OR' | 'AND'>('OR')
  const [connectionLineStart, setConnectionLineStart] = useState<{ x: number; y: number } | null>(null)
  const [connectingFromNode, setConnectingFromNode] = useState<{
    nodeId: string
    handleId: string
  } | null>(null)
  const [isMessageConfigOpen, setIsMessageConfigOpen] = useState(false)
  const [editingMessageNode, setEditingMessageNode] = useState<Node | null>(null)
  const [isTriggerConfigOpen, setIsTriggerConfigOpen] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState<TriggerConfig | null>(null)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null)

  // Calcular posição da bolinha baseado no tipo de handle
  const calculateHandlePosition = (rect: DOMRect, handleId: string): { x: number; y: number } => {
    if (handleId === 'trigger-output') {
      // StartNode: bolinha à direita, centro vertical
      return {
        x: rect.right - 6,
        y: rect.top + rect.height / 2
      }
    } else if (handleId === 'next') {
      // MessageNode/ActionNode: bolinha "Próximo" (segunda opção de fluxo)
      return {
        x: rect.right - 4,
        y: rect.bottom - 35 // Aproximadamente onde está a bolinha "Próximo"
      }
    }
    
    return { x: rect.right, y: rect.top }
  }

  // Inicializar triggers do StartNode ao carregar
  useEffect(() => {
    if (initialNodes.length > 0) {
      const startNode = initialNodes.find(n => n.id === 'start-node')
      if (startNode?.data?.triggers && Array.isArray(startNode.data.triggers)) {
        setFlowTriggers(startNode.data.triggers)
      }
    }
  }, [initialNodes])

  // Criar nó start automaticamente quando fluxo está vazio
  useEffect(() => {
    if (nodes.length === 0 && initialNodes.length === 0) {
      const startNode: Node = {
        id: 'start-node',
        type: 'start',
        position: { x: 250, y: 100 },
                data: {
          triggers: flowTriggers,
          triggerOperator,
          onAddTrigger: () => setIsTriggerSelectorOpen(true),
          onRemoveTrigger: (triggerId: string) => {
            setFlowTriggers(prev => prev.filter(t => t.id !== triggerId))
          },
          onEditTrigger: (triggerId: string) => {
            const trigger = flowTriggers.find(t => t.id === triggerId)
            if (trigger) {
              setEditingTrigger(trigger)
              setIsTriggerConfigOpen(true)
            }
          },
          onOperatorChange: (operator: 'OR' | 'AND') => {
            setTriggerOperator(operator)
          },
          onOpenActionMenu: () => {
            // Calcular posição do menu próximo ao nó
            const nodeElement = document.querySelector('[data-id="start-node"]')
            if (nodeElement) {
              const rect = nodeElement.getBoundingClientRect()
              setActionMenuPosition({ x: rect.right + 10, y: rect.top })
            }
            setIsActionMenuOpen(true)
          }
        },
        draggable: true
      }
      setNodes([startNode])
    }
  }, [initialNodes.length])

  // Atualizar StartNode quando triggers mudar
  useEffect(() => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === 'start-node') {
          return {
            ...node,
                        data: {
              ...node.data,
              triggers: flowTriggers,
              triggerOperator,
              onAddTrigger: () => setIsTriggerSelectorOpen(true),
              onRemoveTrigger: (triggerId: string) => {
                setFlowTriggers(prev => prev.filter(t => t.id !== triggerId))
              },
              onEditTrigger: (triggerId: string) => {
                const trigger = flowTriggers.find(t => t.id === triggerId)
                if (trigger) {
                  setEditingTrigger(trigger)
                  setIsTriggerConfigOpen(true)
                }
              },
              onOperatorChange: (operator: 'OR' | 'AND') => {
                setTriggerOperator(operator)
              }
            }
          }
        }
        return node
      })
    )
  }, [flowTriggers])

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

  // Detectar quando usuário começa a arrastar handle
  const onConnectStart = useCallback(
    (_: any, params: any) => {
      // Detectar arrasto de handles que devem abrir menu de ações
      if (params.handleId === 'trigger-output' || params.handleId === 'next') {
        setConnectingFromNode({
          nodeId: params.nodeId,
          handleId: params.handleId
        })
      }
    },
    []
  )

  // Detectar quando usuário arrasta handle e solta em área vazia
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      // Se estava conectando de algum nó e soltou em área vazia
      if (connectingFromNode) {
        const target = event.target as HTMLElement
        const isOverNode = target.closest('.react-flow__node')
        
        // Verificar se não soltou em um nó
        if (!isOverNode) {
          // Calcular posição da bolinha do nó de origem
          const sourceNodeElement = document.querySelector(`[data-id="${connectingFromNode.nodeId}"]`)
          if (sourceNodeElement) {
            const rect = sourceNodeElement.getBoundingClientRect()
            const bolinhaPos = calculateHandlePosition(rect, connectingFromNode.handleId)
            setConnectionLineStart(bolinhaPos)
          }
          
          // Calcular posição do menu próximo ao cursor
          const clientX = 'clientX' in event ? event.clientX : 0
          const clientY = 'clientY' in event ? event.clientY : 0
          
          const position = {
            x: clientX,
            y: clientY
          }
          setActionMenuPosition(position)
          setIsActionMenuOpen(true)
          // NÃO limpar connectingFromNode aqui - será limpo ao selecionar ação ou fechar menu
        } else {
          // Limpar apenas se não abriu menu
          setConnectingFromNode(null)
        }
      }
    },
    [connectingFromNode, calculateHandlePosition]
  )

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Não abrir configuração para StartNode (não tem configurações)
      if (node.type === 'start') {
        return
      }
      
      // Abrir MessageConfigModal apenas para MessageNode
      if (node.type === 'message') {
        setEditingMessageNode(node)
        setIsMessageConfigOpen(true)
        return
      }
      
      // Para todos os outros nós (delay, action, condition), usar NodeConfigPanel
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
      
      // Garantir que StartNode tem triggers atualizados antes de salvar
      const updatedNodes = nodes.map(node => {
        if (node.id === 'start-node') {
          return {
            ...node,
                        data: {
              ...node.data,
              triggers: flowTriggers,
              triggerOperator
            }
          }
        }
        return node
      })
      
      await onSave(updatedNodes, edges)
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

  const handleMessageConfigSave = (config: any) => {
    if (!editingMessageNode) return

    console.log('🔄 FlowCanvas SALVANDO CONFIG:', {
      nodeId: editingMessageNode.id,
      messageType: config.messageType,
      duration: config.duration,
      unit: config.unit,
      fullConfig: config
    })

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === editingMessageNode.id) {
          const updatedNode = {
            ...node,
            data: {
              ...node.data,
              config
            }
          }
          console.log('✅ Nó atualizado:', updatedNode)
          return updatedNode
        }
        return node
      })
    )

    setIsMessageConfigOpen(false)
    setEditingMessageNode(null)
  }

  const handleAddTrigger = (triggerType: string, triggerLabel: string, triggerDescription?: string) => {
    // Atualizar o StartNode com o gatilho selecionado
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === 'start-node') {
          return {
            ...node,
            data: {
              ...node.data,
              selectedTrigger: {
                type: triggerType,
                label: triggerLabel,
                description: triggerDescription
              }
            }
          }
        }
        return node
      })
    )
  }

  const handleSelectAction = (actionType: string) => {
    // Usar nó de origem armazenado
    if (!connectingFromNode) return
    
    const sourceNode = nodes.find((n) => n.id === connectingFromNode.nodeId)
    if (!sourceNode) return

    // Criar nó de ação conectado ao nó de origem
    const newNode: Node = {
      id: `${actionType}-${Date.now()}`,
      type: actionType,
      position: { 
        x: sourceNode.position.x + 200, 
        y: sourceNode.position.y 
      },
      data: {
        label: actionType === 'message' ? 'Mensagem' : 
               actionType === 'action' ? 'Ação' :
               actionType === 'condition' ? 'Condição' :
               actionType === 'delay' ? 'Espera' : 'Ação',
        config: {}
      }
    }

    // Criar edge conectando nó de origem ao novo nó
    const newEdge: Edge = {
      id: `edge-${Date.now()}`,
      source: connectingFromNode.nodeId,
      sourceHandle: connectingFromNode.handleId,
      target: newNode.id,
      type: 'custom',
      data: { label: '', color: '#94a3b8' }
    }

    setNodes((nds) => nds.concat(newNode))
    setEdges((eds) => eds.concat(newEdge))
    setConnectingFromNode(null) // Limpar estado após criar nó
  }

  return (
    <div className="w-full h-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick}
        onInit={setReactFlowInstance}
        onDrop={onDrop}
        onDragOver={onDragOver}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={{
          type: 'custom',
          focusable: true
        }}
        fitView
        attributionPosition="bottom-left"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={0.5} />
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

      {/* Modal Adicionar Gatilho */}
      <AddTriggerModal
        isOpen={isAddTriggerModalOpen}
        onClose={() => setIsAddTriggerModalOpen(false)}
        onSelectTrigger={handleAddTrigger}
      />

      {/* Menu de Ações */}
      <ActionMenu
        isOpen={isActionMenuOpen}
        onClose={() => {
          setIsActionMenuOpen(false)
          setConnectionLineStart(null)
          setConnectingFromNode(null) // Limpar estado de conexão
        }}
        onSelectAction={handleSelectAction}
        position={actionMenuPosition}
        lineStart={connectionLineStart}
      />

      {/* Modal de Configuração de Mensagem */}
      <MessageConfigModal
        isOpen={isMessageConfigOpen}
        onClose={() => {
          setIsMessageConfigOpen(false)
          setEditingMessageNode(null)
        }}
        config={editingMessageNode?.data?.config || {}}
        onSave={handleMessageConfigSave}
      />

      {/* Modal Seletor de Gatilho */}
      <TriggerSelectorModal
        isOpen={isTriggerSelectorOpen}
        onClose={() => setIsTriggerSelectorOpen(false)}
        onSelect={(trigger) => {
          setFlowTriggers(prev => [...prev, trigger])
          setIsTriggerSelectorOpen(false)
        }}
      />

      {/* Modal de Configuração de Gatilho */}
      <TriggerConfigModal
        isOpen={isTriggerConfigOpen}
        onClose={() => {
          setIsTriggerConfigOpen(false)
          setEditingTrigger(null)
        }}
        trigger={editingTrigger}
        onSave={(triggerId, config) => {
          setFlowTriggers(prev => prev.map(t => 
            t.id === triggerId ? { ...t, config } : t
          ))
          setIsTriggerConfigOpen(false)
          setEditingTrigger(null)
        }}
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
