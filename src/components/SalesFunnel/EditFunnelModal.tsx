// =====================================================
// COMPONENTE: EditFunnelModal
// Data: 03/03/2026
// Objetivo: Modal para editar funil de vendas existente
// =====================================================

import { useState, useEffect, useRef } from 'react'
import { X, Loader2, AlertCircle, Trash2, GripVertical, Plus, Edit2, Save, XCircle } from 'lucide-react'
import type { SalesFunnel, FunnelStage, UpdateFunnelForm } from '../../types/sales-funnel'
import { validateFunnelName } from '../../types/sales-funnel'
import { funnelApi } from '../../services/funnelApi'

interface EditFunnelModalProps {
  isOpen: boolean
  onClose: () => void
  funnel: SalesFunnel
  onUpdate: () => Promise<void>
}

export const EditFunnelModal: React.FC<EditFunnelModalProps> = ({
  isOpen,
  onClose,
  funnel,
  onUpdate
}) => {
  const [formData, setFormData] = useState<UpdateFunnelForm>({
    name: funnel.name,
    description: funnel.description || '',
    is_default: funnel.is_default,
    is_active: funnel.is_active
  })
  const [stages, setStages] = useState<FunnelStage[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingStages, setLoadingStages] = useState(true)
  const [error, setError] = useState<string>()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  
  // Estados para gerenciamento de etapas
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editingStageName, setEditingStageName] = useState('')
  const [showAddStage, setShowAddStage] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageColor, setNewStageColor] = useState('#93C5FD')
  const [deletingStageId, setDeletingStageId] = useState<string | null>(null)
  const [moveToStageId, setMoveToStageId] = useState<string>('')
  const [draggedStage, setDraggedStage] = useState<FunnelStage | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Carregar etapas do funil
  useEffect(() => {
    if (isOpen && funnel.id) {
      loadStages()
    }
  }, [isOpen, funnel.id])

  const loadStages = async () => {
    try {
      setLoadingStages(true)
      const data = await funnelApi.getStages(funnel.id)
      console.log('Stages loaded:', data)
      console.log('Stage IDs:', data.map(s => ({ name: s.name, id: s.id, idLength: s.id?.length })))
      setStages(data)
    } catch (err) {
      console.error('Error loading stages:', err)
    } finally {
      setLoadingStages(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validar nome
    if (!formData.name) {
      setError('Nome do funil é obrigatório')
      return
    }
    
    const validation = validateFunnelName(formData.name)
    if (!validation.valid) {
      setError(validation.error)
      return
    }

    try {
      setLoading(true)
      setError(undefined)
      await funnelApi.updateFunnel(funnel.id, {
        ...formData,
        description: formData.description || undefined
      })
      await onUpdate()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar funil')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteFunnel = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true)
      return
    }

    try {
      setLoading(true)
      setError(undefined)
      await funnelApi.deleteFunnel(funnel.id)
      await onUpdate()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao deletar funil')
      setShowDeleteConfirm(false)
    } finally {
      setLoading(false)
    }
  }

  // Gerenciamento de etapas
  const handleEditStage = (stage: FunnelStage) => {
    setEditingStageId(stage.id)
    setEditingStageName(stage.name)
    setTimeout(() => editInputRef.current?.focus(), 0)
  }

  const handleSaveEditStage = async () => {
    if (!editingStageId || !editingStageName.trim()) return

    try {
      const response = await fetch('/api/funnel/update-stage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_id: editingStageId,
          name: editingStageName.trim()
        })
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('API ainda não disponível. Aguarde 1-2 minutos para o deploy completar.')
        }
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json()
          throw new Error(data.error || 'Erro ao atualizar etapa')
        } else {
          throw new Error('Erro ao atualizar etapa. Aguarde o deploy completar.')
        }
      }

      await loadStages()
      setEditingStageId(null)
      setEditingStageName('')
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar etapa')
    }
  }

  const handleCancelEditStage = () => {
    setEditingStageId(null)
    setEditingStageName('')
  }

  const handleAddStage = async () => {
    if (!newStageName.trim()) {
      setError('Nome da etapa é obrigatório')
      return
    }

    try {
      const response = await fetch('/api/funnel/create-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funnel_id: funnel.id,
          name: newStageName.trim(),
          color: newStageColor
        })
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('API ainda não disponível. Aguarde 1-2 minutos para o deploy completar.')
        }
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json()
          throw new Error(data.error || 'Erro ao criar etapa')
        } else {
          throw new Error('Erro ao criar etapa. Aguarde o deploy completar.')
        }
      }

      await loadStages()
      setShowAddStage(false)
      setNewStageName('')
      setNewStageColor('#93C5FD')
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar etapa')
    }
  }

  const handleDeleteStage = async (stageId: string) => {
    setDeletingStageId(stageId)
    setMoveToStageId('')
  }

  const handleConfirmDeleteStage = async () => {
    if (!deletingStageId) return

    try {
      const response = await fetch('/api/funnel/delete-stage', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage_id: deletingStageId,
          move_to_stage_id: moveToStageId || undefined
        })
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('API ainda não disponível. Aguarde 1-2 minutos para o deploy completar.')
        }
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json()
          if (data.lead_count > 0 && !moveToStageId) {
            setError(data.message)
            return
          }
          throw new Error(data.error || 'Erro ao deletar etapa')
        } else {
          throw new Error('Erro ao deletar etapa. Aguarde o deploy completar.')
        }
      }

      await loadStages()
      setDeletingStageId(null)
      setMoveToStageId('')
      setError(undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao deletar etapa')
    }
  }

  const handleDragStart = (e: React.DragEvent, stage: FunnelStage) => {
    e.dataTransfer.effectAllowed = 'move'
    setDraggedStage(stage)
    console.log('Drag started:', stage.name)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }

  const handleDragLeave = () => {
    setDragOverIndex(null)
  }

  const handleDrop = async (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault()
    
    if (!draggedStage) {
      console.log('No dragged stage')
      return
    }

    const currentIndex = stages.findIndex(s => s.id === draggedStage.id)
    console.log('Drop:', { from: currentIndex, to: dropIndex, stage: draggedStage.name })
    
    if (currentIndex === dropIndex) {
      setDraggedStage(null)
      setDragOverIndex(null)
      return
    }

    // Reordenar localmente
    const newStages = [...stages]
    newStages.splice(currentIndex, 1)
    newStages.splice(dropIndex, 0, draggedStage)

    // Atualizar posições
    const updatedStages = newStages.map((stage, index) => {
      // Validar e corrigir UUID se necessário
      let validId = stage.id
      if (validId && validId.length !== 36) {
        console.warn(`Invalid UUID length for stage ${stage.name}: ${validId.length} chars`)
        // Se tiver 35 caracteres, adicionar um caractere no final
        if (validId.length === 35) {
          validId = validId + '1'
          console.log(`Fixed UUID: ${stage.id} -> ${validId}`)
        }
        // Se tiver 37 caracteres, remover o último
        else if (validId.length === 37) {
          validId = validId.slice(0, 36)
          console.log(`Fixed UUID: ${stage.id} -> ${validId}`)
        }
      }
      
      return {
        id: validId,
        position: index
      }
    })

    console.log('Reordering stages:', updatedStages)
    console.log('Funnel ID:', funnel.id)
    console.log('Request payload:', JSON.stringify({
      funnel_id: funnel.id,
      stages: updatedStages
    }, null, 2))

    try {
      console.log('Calling API: /api/funnel/reorder-stages')
      const response = await fetch('/api/funnel/reorder-stages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          funnel_id: funnel.id,
          stages: updatedStages
        })
      })

      console.log('Response status:', response.status)
      console.log('Response headers:', Object.fromEntries(response.headers.entries()))

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('API ainda não disponível. Aguarde 1-2 minutos para o deploy completar.')
        }
        const contentType = response.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const data = await response.json()
          throw new Error(data.error || 'Erro ao reordenar etapas')
        } else {
          throw new Error('Erro ao reordenar etapas. Aguarde o deploy completar.')
        }
      }

      console.log('Reorder successful')
      await loadStages()
      setError(undefined)
    } catch (err) {
      console.error('Reorder error:', err)
      setError(err instanceof Error ? err.message : 'Erro ao reordenar etapas')
    } finally {
      setDraggedStage(null)
      setDragOverIndex(null)
    }
  }

  const handleDragEnd = () => {
    setDraggedStage(null)
    setDragOverIndex(null)
  }

  const handleClose = () => {
    if (!loading) {
      setFormData({
        name: funnel.name,
        description: funnel.description || '',
        is_default: funnel.is_default,
        is_active: funnel.is_active
      })
      setError(undefined)
      setShowDeleteConfirm(false)
      setEditingStageId(null)
      setShowAddStage(false)
      setDeletingStageId(null)
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Editar Funil
          </h2>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Erro */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Nome */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nome do Funil *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ex: Vendas Corporativas"
                required
                disabled={loading}
              />
            </div>

            {/* Descrição */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Descrição
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Descreva o objetivo deste funil..."
                rows={3}
                disabled={loading}
              />
            </div>

            {/* Opções */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_default}
                  onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  disabled={loading}
                />
                <span className="text-sm text-gray-700">Definir como funil padrão</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  disabled={loading}
                />
                <span className="text-sm text-gray-700">Funil ativo</span>
              </label>
            </div>

            {/* Etapas */}
            <div className="border-t border-gray-200 pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-medium text-gray-900">
                  Etapas do Funil ({stages.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddStage(true)}
                  disabled={loading || showAddStage}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar
                </button>
              </div>

              {loadingStages ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {/* Form de adicionar etapa */}
                  {showAddStage && (
                    <div className="p-3 bg-blue-50 rounded-lg border-2 border-blue-200">
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="color"
                          value={newStageColor}
                          onChange={(e) => setNewStageColor(e.target.value)}
                          className="w-8 h-8 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={newStageName}
                          onChange={(e) => setNewStageName(e.target.value)}
                          placeholder="Nome da nova etapa..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddStage()
                            if (e.key === 'Escape') {
                              setShowAddStage(false)
                              setNewStageName('')
                            }
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleAddStage}
                          className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                        >
                          <Save className="w-3 h-3" />
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddStage(false)
                            setNewStageName('')
                            setError(undefined)
                          }}
                          className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Lista de etapas */}
                  {stages.map((stage, index) => (
                    <div
                      key={stage.id}
                      draggable={!editingStageId && !deletingStageId}
                      onDragStart={(e) => handleDragStart(e, stage)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      className={`
                        flex items-center gap-3 p-3 rounded-lg border transition-all
                        ${dragOverIndex === index ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-gray-50'}
                        ${draggedStage?.id === stage.id ? 'opacity-50' : ''}
                        ${!editingStageId && !deletingStageId ? 'cursor-move' : ''}
                      `}
                    >
                      <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />
                      
                      {editingStageId === stage.id ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingStageName}
                          onChange={(e) => setEditingStageName(e.target.value)}
                          className="flex-1 px-2 py-1 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEditStage()
                            if (e.key === 'Escape') handleCancelEditStage()
                          }}
                        />
                      ) : (
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {stage.name}
                          </p>
                          {stage.is_system_stage && (
                            <p className="text-xs text-gray-500">Etapa do sistema</p>
                          )}
                        </div>
                      )}

                      <span className="text-xs text-gray-500 flex-shrink-0">#{index + 1}</span>

                      {editingStageId === stage.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={handleSaveEditStage}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                            title="Salvar"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEditStage}
                            className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            title="Cancelar"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleEditStage(stage)}
                            disabled={!!editingStageId || !!deletingStageId}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50"
                            title="Editar"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {!stage.is_system_stage && (
                            <button
                              type="button"
                              onClick={() => handleDeleteStage(stage.id)}
                              disabled={!!editingStageId || !!deletingStageId}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                              title="Deletar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Modal de confirmação de deleção */}
              {deletingStageId && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-medium text-red-900 mb-3">
                    ⚠️ Confirmar exclusão da etapa
                  </p>
                  <p className="text-sm text-red-700 mb-3">
                    Escolha para onde mover os leads desta etapa:
                  </p>
                  <select
                    value={moveToStageId}
                    onChange={(e) => setMoveToStageId(e.target.value)}
                    className="w-full px-3 py-2 border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 mb-3"
                  >
                    <option value="">Selecione uma etapa...</option>
                    {stages
                      .filter(s => s.id !== deletingStageId)
                      .map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))
                    }
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmDeleteStage}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                    >
                      Confirmar Exclusão
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeletingStageId(null)
                        setMoveToStageId('')
                        setError(undefined)
                      }}
                      className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </form>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={handleDeleteFunnel}
            disabled={loading}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50
              ${showDeleteConfirm 
                ? 'bg-red-600 text-white hover:bg-red-700' 
                : 'text-red-600 hover:bg-red-50'
              }
            `}
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-sm">
              {showDeleteConfirm ? 'Confirmar Exclusão' : 'Deletar Funil'}
            </span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:opacity-50"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Salvar Alterações</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
