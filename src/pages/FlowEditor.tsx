// =====================================================
// PAGE: FLOW EDITOR
// Data: 13/03/2026
// Objetivo: Página de edição de fluxo de automação
// =====================================================

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Node, Edge } from 'reactflow'
import { ArrowLeft, Loader } from 'lucide-react'
import FlowCanvas from '../components/Automation/FlowCanvas'
import { automationApi } from '../services/automationApi'
import type { AutomationFlow } from '../types/automation'

export default function FlowEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [flow, setFlow] = useState<AutomationFlow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadFlow()
  }, [id])

  const loadFlow = async () => {
    if (!id) return

    try {
      setLoading(true)
      const data = await automationApi.getFlow(id)
      setFlow(data)
      setError(null)
    } catch (err) {
      console.error('Erro ao carregar fluxo:', err)
      setError('Erro ao carregar fluxo')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (nodes: Node[], edges: Edge[]) => {
    if (!id) return

    await automationApi.saveFlowCanvas(id, {
      nodes: nodes as any,
      edges: edges as any
    })

    await loadFlow()
  }

  const handleToggleActive = async (isActive: boolean) => {
    if (!id) return

    await automationApi.toggleFlowActive(id, isActive)
    await loadFlow()
  }

  const handleDelete = async () => {
    if (!id) return

    await automationApi.deleteFlow(id)
    navigate('/automations')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader className="animate-spin h-12 w-12 text-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Carregando fluxo...</p>
        </div>
      </div>
    )
  }

  if (error || !flow) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Fluxo não encontrado'}</p>
          <button
            onClick={() => navigate('/automations')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/automations')}
              className="text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{flow.name}</h1>
              {flow.description && (
                <p className="text-sm text-gray-500">{flow.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>Execuções: {flow.execution_count}</span>
            <span>•</span>
            <span>Sucesso: {flow.success_count}</span>
            <span>•</span>
            <span>Erros: {flow.error_count}</span>
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1">
        <FlowCanvas
          flowId={flow.id}
          initialNodes={flow.nodes as Node[]}
          initialEdges={flow.edges as Edge[]}
          isActive={flow.is_active}
          onSave={handleSave}
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
        />
      </div>
    </div>
  )
}
