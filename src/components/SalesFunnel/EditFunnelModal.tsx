// =====================================================
// COMPONENTE: EditFunnelModal
// Data: 03/03/2026
// Objetivo: Modal para editar funil de vendas existente
// =====================================================

import { useState, useEffect } from 'react'
import { X, Loader2, AlertCircle, Trash2, GripVertical } from 'lucide-react'
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
              </div>

              {loadingStages ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {stages.map((stage, index) => (
                    <div
                      key={stage.id}
                      className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <GripVertical className="w-4 h-4 text-gray-400" />
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {stage.name}
                        </p>
                        {stage.is_system_stage && (
                          <p className="text-xs text-gray-500">Etapa do sistema</p>
                        )}
                      </div>
                      <span className="text-xs text-gray-500">#{index + 1}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-gray-500 mt-3">
                💡 Para adicionar, editar ou reordenar etapas, use a interface do funil principal
              </p>
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
