// =====================================================
// PAGE: FLOW EDITOR
// Data: 13/03/2026
// Objetivo: Página de edição de fluxo de automação
// =====================================================

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Node, Edge } from 'reactflow'
import { ArrowLeft, Loader, Undo, Redo, Copy, Clipboard, FileText, Download, Upload } from 'lucide-react'
import FlowCanvas from '../components/Automation/FlowCanvas'
import BlockLibrary from '../components/Automation/BlockLibrary'
import NodeConfigPanel from '../components/Automation/NodeConfigPanel'
import TemplateModal from '../components/Automation/TemplateModal'
import { automationApi } from '../services/automationApi'
import type { AutomationFlow } from '../types/automation'
import { useUndoRedo } from '../hooks/useUndoRedo'
import { validateFlow, formatValidationMessages, type ValidationResult } from '../utils/flowValidation'

export default function FlowEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [flow, setFlow] = useState<AutomationFlow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<Node | null>(null)
  const [clipboard, setClipboard] = useState<Node | null>(null)
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null)
  const [showValidation, setShowValidation] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  
  // FASE 6.1: Undo/Redo
  const { canUndo, canRedo, undo, redo, takeSnapshot } = useUndoRedo(
    flow?.nodes as Node[] || [],
    flow?.edges as Edge[] || []
  )

  // FASE 6.3: Validar fluxo ao salvar
  const validateAndSave = useCallback(async (nodes: Node[], edges: Edge[]) => {
    const result = validateFlow(nodes, edges)
    setValidationResult(result)
    
    if (!result.isValid) {
      setShowValidation(true)
      alert('❌ O fluxo contém erros que precisam ser corrigidos:\n\n' + formatValidationMessages(result))
      return false
    }
    
    if (result.warnings.length > 0) {
      const proceed = confirm('⚠️ O fluxo contém avisos:\n\n' + formatValidationMessages(result) + '\n\nDeseja salvar mesmo assim?')
      if (!proceed) {
        setShowValidation(true)
        return false
      }
    }
    
    return true
  }, [])

  // FASE 6.2: Copiar/Colar blocos
  const handleCopyNode = useCallback(() => {
    if (selectedNode) {
      setClipboard(selectedNode)
    }
  }, [selectedNode])

  const handlePasteNode = useCallback(() => {
    if (clipboard && flow) {
      const newNode: Node = {
        ...clipboard,
        id: `${clipboard.type}-${Date.now()}`,
        position: {
          x: clipboard.position.x + 50,
          y: clipboard.position.y + 50
        }
      }
      
      const updatedNodes = [...(flow.nodes as Node[]), newNode]
      handleSave(updatedNodes, flow.edges as Edge[])
      takeSnapshot(updatedNodes, flow.edges as Edge[])
    }
  }, [clipboard, flow])

  // FASE 6.4: Aplicar template
  const handleApplyTemplate = useCallback((nodes: Node[], edges: Edge[]) => {
    if (flow) {
      handleSave(nodes, edges)
      takeSnapshot(nodes, edges)
    }
  }, [flow])

  // FASE 6.5: Exportar fluxo como JSON
  const handleExportFlow = useCallback(() => {
    if (!flow) return

    const exportData = {
      name: flow.name,
      description: flow.description,
      nodes: flow.nodes,
      edges: flow.edges,
      variables: flow.variables || {},
      exportedAt: new Date().toISOString(),
      version: '1.0'
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${flow.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [flow])

  // FASE 6.5: Importar fluxo de JSON
  const handleImportFlow = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]
      if (!file) return

      try {
        const text = await file.text()
        const importData = JSON.parse(text)

        if (!importData.nodes || !importData.edges) {
          alert('❌ Arquivo JSON inválido. Certifique-se de que contém nodes e edges.')
          return
        }

        const proceed = confirm(
          `📥 Importar fluxo?\n\n` +
          `Nome: ${importData.name || 'Sem nome'}\n` +
          `Blocos: ${importData.nodes.length}\n` +
          `Conexões: ${importData.edges.length}\n\n` +
          `Isso substituirá o fluxo atual. Deseja continuar?`
        )

        if (proceed) {
          handleSave(importData.nodes, importData.edges)
          takeSnapshot(importData.nodes, importData.edges)
        }
      } catch (error) {
        console.error('Erro ao importar:', error)
        alert('❌ Erro ao importar arquivo. Verifique se é um JSON válido.')
      }
    }

    input.click()
  }, [])

  useEffect(() => {
    loadFlow()
  }, [id])

  // Atalhos de teclado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      }
      // Ctrl/Cmd + Shift + Z = Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault()
        redo()
      }
      // Ctrl/Cmd + C = Copy
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        handleCopyNode()
      }
      // Ctrl/Cmd + V = Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        handlePasteNode()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [undo, redo, handleCopyNode, handlePasteNode])

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

    // FASE 6.3: Validar antes de salvar
    const canSave = await validateAndSave(nodes, edges)
    if (!canSave) return

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

  const handleNodeConfigSave = (nodeId: string, config: any) => {
    if (!flow) return

    const updatedNodes = flow.nodes.map((node: any) =>
      node.id === nodeId ? { ...node, data: { ...node.data, config } } : node
    )

    setFlow({ ...flow, nodes: updatedNodes })
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
    <div className="flex flex-col h-screen overflow-hidden">
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

          {/* FASE 6: Botões de Undo/Redo e Copiar/Colar */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border-r border-gray-300 pr-4">
              <button
                onClick={undo}
                disabled={!canUndo}
                className={`p-2 rounded hover:bg-gray-100 ${
                  !canUndo ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="Desfazer (Ctrl+Z)"
              >
                <Undo className="w-5 h-5" />
              </button>
              <button
                onClick={redo}
                disabled={!canRedo}
                className={`p-2 rounded hover:bg-gray-100 ${
                  !canRedo ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="Refazer (Ctrl+Shift+Z)"
              >
                <Redo className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 border-r border-gray-300 pr-4">
              <button
                onClick={handleCopyNode}
                disabled={!selectedNode}
                className={`p-2 rounded hover:bg-gray-100 ${
                  !selectedNode ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="Copiar bloco (Ctrl+C)"
              >
                <Copy className="w-5 h-5" />
              </button>
              <button
                onClick={handlePasteNode}
                disabled={!clipboard}
                className={`p-2 rounded hover:bg-gray-100 ${
                  !clipboard ? 'opacity-50 cursor-not-allowed' : ''
                }`}
                title="Colar bloco (Ctrl+V)"
              >
                <Clipboard className="w-5 h-5" />
              </button>
            </div>

            {/* FASE 6.4 e 6.5: Templates e Importar/Exportar */}
            <div className="flex items-center gap-2 border-r border-gray-300 pr-4">
              <button
                onClick={() => setShowTemplateModal(true)}
                className="p-2 rounded hover:bg-gray-100"
                title="Templates prontos"
              >
                <FileText className="w-5 h-5" />
              </button>
              <button
                onClick={handleExportFlow}
                className="p-2 rounded hover:bg-gray-100"
                title="Exportar JSON"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={handleImportFlow}
                className="p-2 rounded hover:bg-gray-100"
                title="Importar JSON"
              >
                <Upload className="w-5 h-5" />
              </button>
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
      </div>

      {/* Canvas with Sidebar */}
      <div className="flex-1 flex">
        <BlockLibrary />
        <div className="flex-1">
          <FlowCanvas
            flowId={flow.id}
            initialNodes={flow.nodes as Node[]}
            initialEdges={flow.edges as Edge[]}
            isActive={flow.is_active}
            onSave={handleSave}
            onToggleActive={handleToggleActive}
            onDelete={handleDelete}
            selectedNode={selectedNode}
            onNodeSelect={setSelectedNode}
            onNodeConfigSave={handleNodeConfigSave}
          />
        </div>
        {selectedNode && (
          <NodeConfigPanel
            selectedNode={selectedNode}
            onClose={() => setSelectedNode(null)}
            onSave={handleNodeConfigSave}
          />
        )}
      </div>

      {/* FASE 6.4: Template Modal */}
      <TemplateModal
        isOpen={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        onSelectTemplate={handleApplyTemplate}
      />
    </div>
  )
}
