// =====================================================
// MODAL DE UPLOAD COM SELETOR DE PASTA - V2 CACHE BYPASS
// =====================================================
// Versão com timestamp único para forçar atualização Vercel
// Criado: 10/01/2026 10:32 - Bypass cache definitivo

import React, { useState } from 'react'
import { CompanyFolder } from '../../../services/mediaLibraryApi'

interface UploadModalV2Props {
  isOpen: boolean
  onClose: () => void
  companyFolders: CompanyFolder[]
  companyId: string
  onUploadSuccess: () => void
}

export const UploadModalV2: React.FC<UploadModalV2Props> = ({
  isOpen,
  onClose,
  companyFolders,
  companyId,
  onUploadSuccess
}) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')
  const [uploading, setUploading] = useState(false)

  console.log('🔥 MODAL V2 CACHE BYPASS - 2026-01-10 10:32 - SELETOR DE PASTA ATIVO')

  if (!isOpen) return null

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return
    
    setSelectedFiles(Array.from(files))
    console.log('📁 Arquivos selecionados:', files.length)
  }

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const files = event.dataTransfer.files
    if (files && files.length > 0) {
      setSelectedFiles(Array.from(files))
      console.log('📁 Arquivos arrastados:', files.length)
    }
  }

  const handleUploadSubmit = async () => {
    if (selectedFiles.length === 0) {
      alert('Selecione pelo menos um arquivo')
      return
    }

    if (!selectedFolderId) {
      alert('Selecione a pasta de destino')
      return
    }

    console.log('🚀 Iniciando upload:', {
      files: selectedFiles.length,
      folder: selectedFolderId,
      company: companyId
    })

    setUploading(true)
    try {
      for (const file of selectedFiles) {
        await uploadFileToFolder(file, selectedFolderId, companyId)
      }
      onUploadSuccess()
      onClose()
      setSelectedFiles([])
      setSelectedFolderId('')
      console.log('✅ Upload concluído com sucesso')
    } catch (error) {
      console.error('❌ Erro no upload:', error)
      alert('Erro ao fazer upload dos arquivos. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  const uploadFileToFolder = async (file: File, folderId: string, companyId: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('company_id', companyId)
    formData.append('folder_id', folderId)

    const response = await fetch('/api/media-library/upload-to-folder', {
      method: 'POST',
      body: formData
    })

    if (!response.ok) {
      throw new Error(`Erro no upload: ${response.statusText}`)
    }

    return await response.json()
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getFileIcon = (file: File): string => {
    if (file.type.startsWith('image/')) return '🖼️'
    if (file.type.startsWith('video/')) return '🎥'
    if (file.type.startsWith('audio/')) return '🎵'
    return '📄'
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-lg font-medium text-gray-900">Upload de Arquivos</h3>
            <div className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium mt-1">
              🔥 V2 CACHE BYPASS - 10:32
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* SELETOR DE PASTA - DESTAQUE VISUAL */}
          <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
            <label className="block text-sm font-bold text-blue-800 mb-2">
              📁 Pasta de destino (OBRIGATÓRIO)
            </label>
            <select
              value={selectedFolderId}
              onChange={(e) => {
                setSelectedFolderId(e.target.value)
                console.log('📁 Pasta selecionada:', e.target.value)
              }}
              className="w-full border-2 border-blue-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">🔽 Selecione uma pasta...</option>
              {companyFolders.map(folder => (
                <option key={folder.id} value={folder.id}>
                  {folder.icon} {folder.name}
                </option>
              ))}
            </select>
            {!selectedFolderId && (
              <div className="text-xs text-blue-600 mt-1 font-medium">
                ⚠️ Escolha onde salvar os arquivos: Chat, Marketing ou Teste
              </div>
            )}
          </div>

          {/* Seletor de Arquivos */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              📤 Arquivos
            </label>
            <div 
              className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload-v2"
              />
              <label
                htmlFor="file-upload-v2"
                className="cursor-pointer"
              >
                <div className="text-gray-400 mb-2">
                  <svg className="w-8 h-8 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-sm text-gray-600 font-medium">
                  Clique para selecionar arquivos ou arraste aqui
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Imagens, vídeos, áudios e documentos
                </p>
              </label>
            </div>
          </div>

          {/* Lista de Arquivos Selecionados */}
          {selectedFiles.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3">
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                📋 Arquivos selecionados ({selectedFiles.length})
              </h4>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between bg-white px-3 py-2 rounded border">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg">{getFileIcon(file)}</span>
                      <div>
                        <div className="text-sm font-medium text-gray-900 truncate max-w-32">
                          {file.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatFileSize(file.size)}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedFiles(files => files.filter((_, i) => i !== index))
                      }}
                      className="text-red-400 hover:text-red-600"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Botões */}
        <div className="flex justify-end space-x-3 mt-6">
          <button
            onClick={onClose}
            disabled={uploading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleUploadSubmit}
            disabled={uploading || selectedFiles.length === 0 || !selectedFolderId}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                <span>Enviando...</span>
              </div>
            ) : (
              `📤 Enviar ${selectedFiles.length > 0 ? `(${selectedFiles.length})` : ''}`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
