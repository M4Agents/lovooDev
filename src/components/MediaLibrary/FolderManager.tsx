// =====================================================
// FOLDER MANAGER - GESTÃO DE PASTAS
// =====================================================
// Componente para criar, renomear e excluir pastas

import React, { useState } from 'react'
import { mediaManagement, MediaFolder } from '../../services/mediaManagement'
import {
  Folder,
  X,
  Plus,
  Edit2,
  Trash2,
  AlertTriangle,
  Loader2
} from 'lucide-react'

// =====================================================
// INTERFACES
// =====================================================

interface FolderManagerProps {
  companyId: string
  parentFolderId?: string
  editFolder?: MediaFolder
  onClose: () => void
  onComplete: () => void
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const FolderManager: React.FC<FolderManagerProps> = ({
  companyId,
  parentFolderId,
  editFolder,
  onClose,
  onComplete
}) => {
  const [folderName, setFolderName] = useState(editFolder?.name || '')
  const [folderIcon, setFolderIcon] = useState(editFolder?.icon || '📁')
  const [folderDescription, setFolderDescription] = useState(editFolder?.description || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!editFolder
  const title = isEditing ? 'Editar Pasta' : 'Nova Pasta'

  // =====================================================
  // VALIDAÇÃO
  // =====================================================

  const validateForm = (): { valid: boolean; error?: string } => {
    if (!folderName.trim()) {
      return { valid: false, error: 'Nome da pasta é obrigatório' }
    }

    const validation = mediaManagement.validateName(folderName.trim())
    if (!validation.valid) {
      return validation
    }

    return { valid: true }
  }

  // =====================================================
  // HANDLERS
  // =====================================================

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const validation = validateForm()
    if (!validation.valid) {
      setError(validation.error || 'Dados inválidos')
      return
    }

    setLoading(true)

    try {
      if (isEditing && editFolder) {
        // Renomear pasta existente
        await mediaManagement.renameFolder(companyId, editFolder.id, folderName.trim())
      } else {
        // Criar nova pasta
        await mediaManagement.createFolder(companyId, {
          name: folderName.trim(),
          parent_id: parentFolderId,
          icon: folderIcon,
          description: folderDescription.trim() || undefined
        })
      }

      onComplete()
    } catch (error) {
      console.error('Erro ao salvar pasta:', error)
      setError(error instanceof Error ? error.message : 'Erro ao salvar pasta')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!editFolder) return

    const confirmed = window.confirm(
      `Tem certeza que deseja excluir a pasta "${editFolder.name}"?\n\nEsta ação não pode ser desfeita.`
    )

    if (!confirmed) return

    setLoading(true)
    setError(null)

    try {
      await mediaManagement.deleteFolder(companyId, editFolder.id)
      onComplete()
    } catch (error) {
      console.error('Erro ao excluir pasta:', error)
      setError(error instanceof Error ? error.message : 'Erro ao excluir pasta')
    } finally {
      setLoading(false)
    }
  }

  // =====================================================
  // ÍCONES DISPONÍVEIS
  // =====================================================

  const availableIcons = [
    '📁', '📂', '📊', '📋', '📄', '📝', '📷', '🎥', '🎵', '🖼️',
    '💼', '🗂️', '📦', '🏢', '🎯', '⚡', '🔧', '🎨', '📚', '🌟'
  ]

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Folder className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Nome da pasta */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Nome da pasta *
            </label>
            <input
              type="text"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Digite o nome da pasta..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
              disabled={loading}
            />
          </div>

          {/* Ícone da pasta */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ícone
            </label>
            <div className="grid grid-cols-10 gap-2">
              {availableIcons.map(icon => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setFolderIcon(icon)}
                  className={`p-2 text-lg rounded-lg border-2 transition-colors ${
                    folderIcon === icon
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  disabled={loading}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Descrição (opcional)
            </label>
            <textarea
              value={folderDescription}
              onChange={(e) => setFolderDescription(e.target.value)}
              placeholder="Descreva o conteúdo desta pasta..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              disabled={loading}
            />
          </div>

          {/* Erro */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          )}

          {/* Preview */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600 mb-2">Preview:</p>
            <div className="flex items-center gap-2">
              <span className="text-lg">{folderIcon}</span>
              <span className="font-medium text-gray-900">
                {folderName.trim() || 'Nome da pasta'}
              </span>
            </div>
            {folderDescription.trim() && (
              <p className="text-sm text-gray-600 mt-1 ml-7">
                {folderDescription.trim()}
              </p>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          {/* Botão de excluir (apenas para edição) */}
          <div>
            {isEditing && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Excluir
              </button>
            )}
          </div>

          {/* Botões principais */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            
            <button
              onClick={handleSubmit}
              disabled={loading || !folderName.trim()}
              className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-colors ${
                loading || !folderName.trim()
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isEditing ? 'Salvando...' : 'Criando...'}
                </>
              ) : (
                <>
                  {isEditing ? (
                    <>
                      <Edit2 className="w-4 h-4" />
                      Salvar
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Criar Pasta
                    </>
                  )}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
