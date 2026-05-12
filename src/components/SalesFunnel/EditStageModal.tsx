// =====================================================
// COMPONENTE: EditStageModal
// Data: 03/03/2026
// Objetivo: Modal para editar/criar etapa do funil
// =====================================================

import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X, Loader2, AlertCircle, Trash2 } from 'lucide-react'
import { HexColorPicker } from 'react-colorful'
import { useAuth } from '../../contexts/AuthContext'
import type { FunnelStage, CreateStageForm, UpdateStageForm } from '../../types/sales-funnel'
import { validateStageName, validateStageColor, FUNNEL_CONSTANTS } from '../../types/sales-funnel'

const PLAYBOOK_ALLOWED_ROLES = ['admin', 'super_admin', 'system_admin']

interface EditStageModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: CreateStageForm | UpdateStageForm) => Promise<void>
  onDelete?: (stageId: string) => Promise<void>
  stage?: FunnelStage
  funnelId: string
  existingStages: FunnelStage[]
}

export const EditStageModal: React.FC<EditStageModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  onDelete,
  stage,
  funnelId,
  existingStages
}) => {
  const { t } = useTranslation('funnel')
  const { currentRole } = useAuth()
  const isEditing = !!stage
  const canEditPlaybook = PLAYBOOK_ALLOWED_ROLES.includes(currentRole ?? '')
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const [formData, setFormData] = useState({
    name: stage?.name || '',
    description: stage?.description || '',
    color: stage?.color || FUNNEL_CONSTANTS.DEFAULT_COLORS.leadNovo,
    stage_type: stage?.stage_type || 'active' as 'active' | 'won' | 'lost',
    position: stage?.position ?? existingStages.length,
    playbook_text: stage?.playbook_text || '',
    video_link: stage?.video_link || '',
  })

  useEffect(() => {
    if (stage) {
      setFormData({
        name: stage.name,
        description: stage.description || '',
        color: stage.color,
        stage_type: stage.stage_type,
        position: stage.position,
        playbook_text: stage.playbook_text || '',
        video_link: stage.video_link || '',
      })
    }
  }, [stage])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validar nome
    const nameValidation = validateStageName(formData.name)
    if (!nameValidation.valid) {
      setError(nameValidation.error)
      return
    }

    // Validar cor
    const colorValidation = validateStageColor(formData.color)
    if (!colorValidation.valid) {
      setError(colorValidation.error)
      return
    }

    try {
      setLoading(true)
      setError(undefined)

      if (isEditing) {
        const updatePayload: UpdateStageForm = {
          name: formData.name,
          description: formData.description,
          color: formData.color,
          stage_type: formData.stage_type,
        }
        if (canEditPlaybook) {
          updatePayload.playbook_text = formData.playbook_text
          updatePayload.video_link    = formData.video_link
        }
        await onSubmit(updatePayload)
      } else {
        await onSubmit({
          funnel_id: funnelId,
          name: formData.name,
          description: formData.description,
          color: formData.color,
          position: formData.position,
          stage_type: formData.stage_type
        } as CreateStageForm)
      }
      
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editStage.errorSave'))
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!stage || !onDelete) return

    try {
      setLoading(true)
      setError(undefined)
      await onDelete(stage.id)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editStage.errorDelete'))
      setShowDeleteConfirm(false)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setFormData({
        name: '',
        description: '',
        color: FUNNEL_CONSTANTS.DEFAULT_COLORS.leadNovo,
        stage_type: 'active',
        position: existingStages.length,
        playbook_text: '',
        video_link: '',
      })
      setError(undefined)
      setShowDeleteConfirm(false)
      setShowColorPicker(false)
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white">
          <h2 className="text-xl font-semibold text-gray-900">
            {isEditing ? t('editStage.titleEdit') : t('editStage.titleNew')}
          </h2>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('editStage.name')}
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder={t('editStage.namePlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading || stage?.is_system_stage}
              required
              maxLength={255}
            />
            {stage?.is_system_stage && (
              <p className="text-xs text-gray-500 mt-1">
                {t('editStage.systemNameLocked')}
              </p>
            )}
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('editStage.description')}
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder={t('editStage.descriptionPlaceholder')}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              disabled={loading}
            />
          </div>

          {/* Cor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('editStage.color')}
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="w-12 h-12 rounded-lg border-2 border-gray-300 shadow-sm hover:border-gray-400 transition-colors"
                style={{ backgroundColor: formData.color }}
                disabled={loading}
              />
              <input
                type="text"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                placeholder="#FCD34D"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                disabled={loading}
                maxLength={7}
              />
            </div>
            
            {showColorPicker && (
              <div className="mt-3">
                <HexColorPicker
                  color={formData.color}
                  onChange={(color: string) => setFormData({ ...formData, color })}
                />
                <div className="flex flex-wrap gap-2 mt-3">
                  {Object.values(FUNNEL_CONSTANTS.DEFAULT_COLORS).map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormData({ ...formData, color })}
                      className="w-8 h-8 rounded border-2 border-gray-300 hover:border-gray-400 transition-colors"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tipo de Etapa */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('editStage.stageType')}
            </label>
            <select
              value={formData.stage_type}
              onChange={(e) => setFormData({ ...formData, stage_type: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading}
            >
              <option value="active">{t('editStage.stageTypeActive')}</option>
              <option value="won">{t('editStage.stageTypeWon')}</option>
              <option value="lost">{t('editStage.stageTypeLost')}</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {formData.stage_type === 'active' && t('editStage.hintActive')}
              {formData.stage_type === 'won' && t('editStage.hintWon')}
              {formData.stage_type === 'lost' && t('editStage.hintLost')}
            </p>
          </div>

          {/* Playbook de Vendas — somente admins em modo edição */}
          {isEditing && canEditPlaybook && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Playbook de Vendas
                </label>
                <textarea
                  value={formData.playbook_text}
                  onChange={(e) => setFormData({ ...formData, playbook_text: e.target.value })}
                  placeholder="Descreva o roteiro de vendas, objeções comuns, perguntas-chave e dicas para esta etapa..."
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y text-sm"
                  disabled={loading}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Visível a todos os usuários no menu da etapa.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Link do Vídeo (YouTube)
                </label>
                <input
                  type="url"
                  value={formData.video_link}
                  onChange={(e) => setFormData({ ...formData, video_link: e.target.value })}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  disabled={loading}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Vídeo exibido no modal de Playbook da etapa.
                </p>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Delete Confirmation */}
          {showDeleteConfirm && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800 mb-3">
                {t('editStage.deleteConfirm')}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={loading}
                  className="px-3 py-1.5 bg-red-600 text-white rounded text-sm hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {t('editStage.deleteYes')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  disabled={loading}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded text-sm hover:bg-gray-50 transition-colors"
                >
                  {t('form.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-4">
            {isEditing && !stage?.is_system_stage && onDelete && !showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={loading}
                className="px-4 py-2 text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {t('editStage.delete')}
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {t('form.cancel')}
              </button>
              <button
                type="submit"
                disabled={loading || !formData.name.trim() || showDeleteConfirm}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? t('form.saving') : isEditing ? t('form.save') : t('editStage.createSubmit')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
