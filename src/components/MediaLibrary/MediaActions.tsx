// =====================================================
// MEDIA ACTIONS - AÇÕES EM LOTE
// =====================================================
// Componente para ações em lote em arquivos selecionados

import React, { useState } from 'react'
import { mediaManagement, MediaFolder } from '../../services/mediaManagement'
import {
  Move,
  Trash2,
  Download,
  X,
  Folder,
  AlertTriangle,
  Loader2,
  CheckCircle
} from 'lucide-react'

// =====================================================
// INTERFACES
// =====================================================

interface MediaActionsProps {
  companyId: string
  selectedFileIds: string[]
  folders: MediaFolder[]
  onClose: () => void
  onComplete: () => void
}

type ActionType = 'move' | 'delete' | 'download'

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const MediaActions: React.FC<MediaActionsProps> = ({
  companyId,
  selectedFileIds,
  folders,
  onClose,
  onComplete
}) => {
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<any>(null)

  const fileCount = selectedFileIds.length

  // =====================================================
  // HANDLERS DE AÇÕES
  // =====================================================

  const handleMove = async () => {
    if (!selectedFolderId) {
      setError('Selecione uma pasta de destino')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await mediaManagement.moveMultipleFiles(
        companyId,
        selectedFileIds,
        selectedFolderId === 'root' ? undefined : selectedFolderId
      )
      
      setResult(result)
      
      if (result.success) {
        setTimeout(() => {
          onComplete()
        }, 1500)
      }
    } catch (error) {
      console.error('Erro ao mover arquivos:', error)
      setError(error instanceof Error ? error.message : 'Erro ao mover arquivos')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    const confirmed = window.confirm(
      `Tem certeza que deseja excluir ${fileCount} arquivo(s)?\n\nEsta ação não pode ser desfeita.`
    )

    if (!confirmed) return

    setLoading(true)
    setError(null)

    try {
      const result = await mediaManagement.deleteMultipleFiles(companyId, selectedFileIds)
      setResult(result)
      
      if (result.success) {
        setTimeout(() => {
          onComplete()
        }, 1500)
      }
    } catch (error) {
      console.error('Erro ao excluir arquivos:', error)
      setError(error instanceof Error ? error.message : 'Erro ao excluir arquivos')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async () => {
    setLoading(true)
    setError(null)

    try {
      // Em uma implementação real, isso criaria um ZIP dos arquivos
      // Por enquanto, simularemos o processo
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      setResult({
        success: true,
        processed: fileCount,
        failed: 0,
        errors: []
      })
      
      setTimeout(() => {
        onComplete()
      }, 1500)
    } catch (error) {
      console.error('Erro ao baixar arquivos:', error)
      setError(error instanceof Error ? error.message : 'Erro ao baixar arquivos')
    } finally {
      setLoading(false)
    }
  }

  const executeAction = async () => {
    switch (selectedAction) {
      case 'move':
        await handleMove()
        break
      case 'delete':
        await handleDelete()
        break
      case 'download':
        await handleDownload()
        break
    }
  }

  // =====================================================
  // RENDERIZAÇÃO CONDICIONAL
  // =====================================================

  const renderActionSelection = () => (
    <div className="p-6 space-y-4">
      <div className="text-center mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Ações em Lote
        </h3>
        <p className="text-gray-600">
          {fileCount} arquivo(s) selecionado(s)
        </p>
      </div>

      <div className="space-y-3">
        {/* Mover */}
        <button
          onClick={() => setSelectedAction('move')}
          className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
        >
          <Move className="w-6 h-6 text-blue-600" />
          <div className="text-left">
            <div className="font-medium text-gray-900">Mover arquivos</div>
            <div className="text-sm text-gray-600">
              Mover para outra pasta
            </div>
          </div>
        </button>

        {/* Baixar */}
        <button
          onClick={() => setSelectedAction('download')}
          className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-colors"
        >
          <Download className="w-6 h-6 text-green-600" />
          <div className="text-left">
            <div className="font-medium text-gray-900">Baixar arquivos</div>
            <div className="text-sm text-gray-600">
              Baixar como arquivo ZIP
            </div>
          </div>
        </button>

        {/* Excluir */}
        <button
          onClick={() => setSelectedAction('delete')}
          className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-lg hover:border-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-6 h-6 text-red-600" />
          <div className="text-left">
            <div className="font-medium text-gray-900">Excluir arquivos</div>
            <div className="text-sm text-gray-600">
              Excluir permanentemente
            </div>
          </div>
        </button>
      </div>
    </div>
  )

  const renderMoveAction = () => (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <Move className="w-6 h-6 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-900">
          Mover {fileCount} arquivo(s)
        </h3>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Pasta de destino
        </label>
        <select
          value={selectedFolderId}
          onChange={(e) => setSelectedFolderId(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Selecione uma pasta...</option>
          <option value="root">📁 Biblioteca (raiz)</option>
          {folders.map(folder => (
            <option key={folder.id} value={folder.id}>
              {folder.icon} {folder.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <span className="text-sm text-red-700">{error}</span>
        </div>
      )}
    </div>
  )

  const renderConfirmAction = () => {
    const actionLabels = {
      move: 'mover',
      delete: 'excluir',
      download: 'baixar'
    }

    const actionIcons = {
      move: <Move className="w-6 h-6 text-blue-600" />,
      delete: <Trash2 className="w-6 h-6 text-red-600" />,
      download: <Download className="w-6 h-6 text-green-600" />
    }

    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          {selectedAction && actionIcons[selectedAction]}
          <h3 className="text-lg font-semibold text-gray-900">
            Confirmar ação
          </h3>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <p className="text-gray-900">
            Você está prestes a <strong>{selectedAction && actionLabels[selectedAction]}</strong> {fileCount} arquivo(s).
          </p>
          
          {selectedAction === 'move' && selectedFolderId && (
            <p className="text-gray-600 mt-2">
              Destino: {selectedFolderId === 'root' ? 'Biblioteca (raiz)' : folders.find(f => f.id === selectedFolderId)?.name}
            </p>
          )}
          
          {selectedAction === 'delete' && (
            <p className="text-red-600 mt-2 font-medium">
              ⚠️ Esta ação não pode ser desfeita!
            </p>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-700">{error}</span>
          </div>
        )}
      </div>
    )
  }

  const renderResult = () => {
    if (!result) return null

    const isSuccess = result.success && result.failed === 0

    return (
      <div className="p-6 space-y-4">
        <div className="text-center">
          {isSuccess ? (
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          ) : (
            <AlertTriangle className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
          )}
          
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {isSuccess ? 'Ação concluída!' : 'Ação parcialmente concluída'}
          </h3>
          
          <div className="text-gray-600 space-y-1">
            <p>Processados: {result.processed}</p>
            {result.failed > 0 && <p>Falharam: {result.failed}</p>}
          </div>
        </div>

        {result.errors && result.errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <h4 className="font-medium text-red-900 mb-2">Erros:</h4>
            <ul className="text-sm text-red-700 space-y-1">
              {result.errors.map((error: string, index: number) => (
                <li key={index}>• {error}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  // =====================================================
  // RENDER PRINCIPAL
  // =====================================================

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-md w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">
            Ações em Lote
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Conteúdo */}
        {result ? (
          renderResult()
        ) : loading ? (
          <div className="p-6 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Processando...</p>
          </div>
        ) : selectedAction === 'move' ? (
          renderMoveAction()
        ) : selectedAction ? (
          renderConfirmAction()
        ) : (
          renderActionSelection()
        )}

        {/* Footer */}
        {!result && !loading && (
          <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
            {selectedAction ? (
              <>
                <button
                  onClick={() => setSelectedAction(null)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Voltar
                </button>
                <button
                  onClick={executeAction}
                  disabled={selectedAction === 'move' && !selectedFolderId}
                  className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                    selectedAction === 'move' && !selectedFolderId
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : selectedAction === 'delete'
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {selectedAction === 'delete' ? 'Excluir' : 
                   selectedAction === 'move' ? 'Mover' : 'Baixar'}
                </button>
              </>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
