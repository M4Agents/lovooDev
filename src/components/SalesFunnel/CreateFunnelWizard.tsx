// =====================================================
// COMPONENTE: CreateFunnelWizard
// Data: 06/03/2026
// Objetivo: Wizard para criar funil com configuração de etapas
// =====================================================

import { useState, useRef } from 'react'
import { X, Loader2, AlertCircle, ChevronRight, ChevronLeft, Check, Plus, Trash2, GripVertical, Edit2, Save, XCircle } from 'lucide-react'
import type { CreateFunnelForm, FunnelStage } from '../../types/sales-funnel'
import { validateFunnelName } from '../../types/sales-funnel'

interface CreateFunnelWizardProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateFunnelForm, stages: Omit<FunnelStage, 'id' | 'funnel_id' | 'created_at' | 'updated_at'>[]) => Promise<void>
}

interface StageForm {
  tempId: string
  name: string
  color: string
  position: number
  is_system_stage: boolean
  stage_type: 'active' | 'won' | 'lost'
}

const DEFAULT_STAGES: StageForm[] = [
  { tempId: '1', name: 'Nova Oportunidade', color: '#FCD34D', position: 0, is_system_stage: true, stage_type: 'active' },
  { tempId: '2', name: 'Contato Realizado', color: '#86EFAC', position: 1, is_system_stage: false, stage_type: 'active' },
  { tempId: '3', name: 'Diagnóstico / Briefing', color: '#93C5FD', position: 2, is_system_stage: false, stage_type: 'active' },
  { tempId: '4', name: 'Proposta Enviada', color: '#C4B5FD', position: 3, is_system_stage: false, stage_type: 'active' },
  { tempId: '5', name: 'Follow-up', color: '#FCA5A5', position: 4, is_system_stage: false, stage_type: 'active' },
  { tempId: '6', name: 'Fechado - Ganhou', color: '#10B981', position: 5, is_system_stage: false, stage_type: 'won' },
  { tempId: '7', name: 'Fechado - Perdeu', color: '#EF4444', position: 6, is_system_stage: false, stage_type: 'lost' }
]

const STAGE_COLORS = [
  '#FCD34D', '#86EFAC', '#93C5FD', '#C4B5FD', '#FCA5A5',
  '#10B981', '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899'
]

export const CreateFunnelWizard: React.FC<CreateFunnelWizardProps> = ({
  isOpen,
  onClose,
  onSubmit
}) => {
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState<CreateFunnelForm>({
    name: '',
    description: '',
    is_default: false,
    is_active: true
  })
  const [stages, setStages] = useState<StageForm[]>(DEFAULT_STAGES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editingStageName, setEditingStageName] = useState('')
  const [showAddStage, setShowAddStage] = useState(false)
  const [newStageName, setNewStageName] = useState('')
  const [newStageColor, setNewStageColor] = useState('#93C5FD')
  const [draggedStage, setDraggedStage] = useState<StageForm | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  const handleNext = () => {
    if (currentStep === 1) {
      const validation = validateFunnelName(formData.name)
      if (!validation.valid) {
        setError(validation.error)
        return
      }
    }
    
    if (currentStep === 2) {
      if (stages.length === 0) {
        setError('Adicione pelo menos uma etapa ao funil')
        return
      }
      const hasWon = stages.some(s => s.stage_type === 'won')
      const hasLost = stages.some(s => s.stage_type === 'lost')
      if (!hasWon || !hasLost) {
        setError('O funil deve ter pelo menos uma etapa de "Ganhou" e uma de "Perdeu"')
        return
      }
    }
    
    setError(undefined)
    setCurrentStep(prev => Math.min(prev + 1, 3))
  }

  const handleBack = () => {
    setError(undefined)
    setCurrentStep(prev => Math.max(prev - 1, 1))
  }

  const handleSubmit = async () => {
    try {
      setLoading(true)
      setError(undefined)
      
      const stagesData = stages.map((stage, index) => ({
        name: stage.name,
        color: stage.color,
        position: index,
        is_system_stage: stage.is_system_stage,
        stage_type: stage.stage_type,
        description: undefined
      }))
      
      await onSubmit(formData, stagesData)
      
      setFormData({ name: '', description: '', is_default: false, is_active: true })
      setStages(DEFAULT_STAGES)
      setCurrentStep(1)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar funil')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setFormData({ name: '', description: '', is_default: false, is_active: true })
      setStages(DEFAULT_STAGES)
      setCurrentStep(1)
      setError(undefined)
      onClose()
    }
  }

  const handleAddStage = () => {
    if (!newStageName.trim()) return
    
    const newStage: StageForm = {
      tempId: Date.now().toString(),
      name: newStageName,
      color: newStageColor,
      position: stages.length,
      is_system_stage: false,
      stage_type: 'active'
    }
    
    setStages([...stages, newStage])
    setNewStageName('')
    setNewStageColor('#93C5FD')
    setShowAddStage(false)
  }

  const handleEditStage = (stageId: string) => {
    const stage = stages.find(s => s.tempId === stageId)
    if (stage) {
      setEditingStageId(stageId)
      setEditingStageName(stage.name)
      setTimeout(() => editInputRef.current?.focus(), 0)
    }
  }

  const handleSaveEdit = () => {
    if (!editingStageName.trim() || !editingStageId) return
    
    setStages(stages.map(s => 
      s.tempId === editingStageId ? { ...s, name: editingStageName } : s
    ))
    setEditingStageId(null)
    setEditingStageName('')
  }

  const handleCancelEdit = () => {
    setEditingStageId(null)
    setEditingStageName('')
  }

  const handleDeleteStage = (stageId: string) => {
    const stage = stages.find(s => s.tempId === stageId)
    if (stage?.is_system_stage) {
      setError('Não é possível deletar a etapa do sistema')
      return
    }
    setStages(stages.filter(s => s.tempId !== stageId).map((s, i) => ({ ...s, position: i })))
  }

  const handleChangeStageColor = (stageId: string, color: string) => {
    setStages(stages.map(s => s.tempId === stageId ? { ...s, color } : s))
  }

  const handleChangeStageType = (stageId: string, type: 'active' | 'won' | 'lost') => {
    setStages(stages.map(s => s.tempId === stageId ? { ...s, stage_type: type } : s))
  }

  const handleDragStart = (stage: StageForm) => {
    setDraggedStage(stage)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault()
    
    if (!draggedStage) return
    
    const draggedIndex = stages.findIndex(s => s.tempId === draggedStage.tempId)
    if (draggedIndex === targetIndex) return
    
    const newStages = [...stages]
    newStages.splice(draggedIndex, 1)
    newStages.splice(targetIndex, 0, draggedStage)
    
    setStages(newStages.map((s, i) => ({ ...s, position: i })))
    setDraggedStage(null)
    setDragOverIndex(null)
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Criar Novo Funil</h2>
            <p className="text-sm text-gray-500 mt-1">
              {currentStep === 1 && 'Informações básicas do funil'}
              {currentStep === 2 && 'Configure as etapas do funil'}
              {currentStep === 3 && 'Revise e confirme'}
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Steps */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center flex-1">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                  step < currentStep ? 'bg-green-500 text-white' :
                  step === currentStep ? 'bg-blue-600 text-white' :
                  'bg-gray-200 text-gray-500'
                }`}>
                  {step < currentStep ? <Check className="w-4 h-4" /> : step}
                </div>
                <div className="ml-2 text-sm font-medium">
                  {step === 1 && 'Básico'}
                  {step === 2 && 'Etapas'}
                  {step === 3 && 'Revisão'}
                </div>
                {step < 3 && (
                  <div className={`flex-1 h-0.5 mx-4 ${
                    step < currentStep ? 'bg-green-500' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Basic Info */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome do Funil *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ex: Funil de Vendas B2B"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={loading}
                  required
                  maxLength={255}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descreva o propósito deste funil..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  disabled={loading}
                />
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_default}
                    onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    disabled={loading}
                  />
                  <span className="text-sm text-gray-700">
                    Definir como funil padrão
                  </span>
                </label>

                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    disabled={loading}
                  />
                  <span className="text-sm text-gray-700">
                    Funil ativo
                  </span>
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Stages */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Arraste para reordenar, clique para editar
                </p>
                <button
                  onClick={() => setShowAddStage(true)}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Adicionar Etapa
                </button>
              </div>

              {/* Add Stage Form */}
              {showAddStage && (
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
                  <input
                    type="text"
                    value={newStageName}
                    onChange={(e) => setNewStageName(e.target.value)}
                    placeholder="Nome da etapa"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddStage()}
                  />
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Cor:</span>
                    <div className="flex gap-2">
                      {STAGE_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => setNewStageColor(color)}
                          className={`w-6 h-6 rounded border-2 ${
                            newStageColor === color ? 'border-gray-900' : 'border-transparent'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddStage}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      Adicionar
                    </button>
                    <button
                      onClick={() => {
                        setShowAddStage(false)
                        setNewStageName('')
                      }}
                      className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              {/* Stages List */}
              <div className="space-y-2">
                {stages.map((stage, index) => (
                  <div
                    key={stage.tempId}
                    draggable={!editingStageId}
                    onDragStart={() => handleDragStart(stage)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDrop={(e) => handleDrop(e, index)}
                    className={`p-4 bg-white border-2 rounded-lg transition-all ${
                      dragOverIndex === index ? 'border-blue-500' : 'border-gray-200'
                    } ${editingStageId === stage.tempId ? 'ring-2 ring-blue-500' : ''}`}
                  >
                    <div className="flex items-center gap-3">
                      <GripVertical className="w-5 h-5 text-gray-400 cursor-move" />
                      
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />

                      {editingStageId === stage.tempId ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editingStageName}
                          onChange={(e) => setEditingStageName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit()
                            if (e.key === 'Escape') handleCancelEdit()
                          }}
                          className="flex-1 px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      ) : (
                        <span className="flex-1 font-medium text-gray-900">{stage.name}</span>
                      )}

                      <select
                        value={stage.stage_type}
                        onChange={(e) => handleChangeStageType(stage.tempId, e.target.value as any)}
                        className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="active">Ativa</option>
                        <option value="won">Ganhou</option>
                        <option value="lost">Perdeu</option>
                      </select>

                      <div className="flex gap-1">
                        {STAGE_COLORS.slice(0, 5).map(color => (
                          <button
                            key={color}
                            onClick={() => handleChangeStageColor(stage.tempId, color)}
                            className={`w-5 h-5 rounded border ${
                              stage.color === color ? 'border-gray-900' : 'border-transparent'
                            }`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>

                      {editingStageId === stage.tempId ? (
                        <>
                          <button
                            onClick={handleSaveEdit}
                            className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                          >
                            <Save className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            className="p-1.5 text-gray-600 hover:bg-gray-50 rounded transition-colors"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleEditStage(stage.tempId)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {!stage.is_system_stage && (
                            <button
                              onClick={() => handleDeleteStage(stage.tempId)}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Review */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <h3 className="font-semibold text-gray-900">Informações do Funil</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Nome:</span>
                    <span className="font-medium text-gray-900">{formData.name}</span>
                  </div>
                  {formData.description && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Descrição:</span>
                      <span className="font-medium text-gray-900">{formData.description}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">Funil padrão:</span>
                    <span className="font-medium text-gray-900">{formData.is_default ? 'Sim' : 'Não'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Status:</span>
                    <span className="font-medium text-gray-900">{formData.is_active ? 'Ativo' : 'Inativo'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <h3 className="font-semibold text-gray-900">Etapas ({stages.length})</h3>
                <div className="space-y-2">
                  {stages.map((stage, index) => (
                    <div key={stage.tempId} className="flex items-center gap-3 text-sm">
                      <span className="text-gray-500 w-6">{index + 1}.</span>
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      <span className="flex-1 font-medium text-gray-900">{stage.name}</span>
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        stage.stage_type === 'won' ? 'bg-green-100 text-green-800' :
                        stage.stage_type === 'lost' ? 'bg-red-100 text-red-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {stage.stage_type === 'won' ? 'Ganhou' :
                         stage.stage_type === 'lost' ? 'Perdeu' : 'Ativa'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200">
          <button
            onClick={currentStep === 1 ? handleClose : handleBack}
            disabled={loading}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {currentStep === 1 ? (
              <>Cancelar</>
            ) : (
              <>
                <ChevronLeft className="w-4 h-4" />
                Voltar
              </>
            )}
          </button>

          <div className="flex gap-2">
            {currentStep < 3 ? (
              <button
                onClick={handleNext}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                Próximo
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Criando...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Criar Funil
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
