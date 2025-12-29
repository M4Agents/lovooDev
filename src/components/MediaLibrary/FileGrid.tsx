// =====================================================
// FILE GRID - VISUALIZAÇÃO DE ARQUIVOS
// =====================================================
// Componente para exibir arquivos em grid ou lista

import React, { useState } from 'react'
import { MediaFileExtended } from '../../services/mediaManagement'
import { mediaLibraryApi } from '../../services/mediaLibraryApi'
import {
  FileText,
  Image,
  Video,
  Music,
  Download,
  Eye,
  MoreHorizontal,
  CheckSquare,
  Square,
  Calendar,
  HardDrive,
  Loader2
} from 'lucide-react'

// =====================================================
// INTERFACES
// =====================================================

interface FileGridProps {
  files: MediaFileExtended[]
  selectedFiles: string[]
  viewMode: 'grid' | 'list'
  loading: boolean
  onFileSelect: (fileId: string, selected: boolean) => void
  onSelectAll: (selectAll: boolean) => void
}

interface FileItemProps {
  file: MediaFileExtended
  isSelected: boolean
  viewMode: 'grid' | 'list'
  onSelect: (fileId: string, selected: boolean) => void
  onPreview: (file: MediaFileExtended) => void
  onDownload: (file: MediaFileExtended) => void
  onAction: (file: MediaFileExtended) => void
}

// =====================================================
// COMPONENTE ITEM DE ARQUIVO
// =====================================================

const FileItem: React.FC<FileItemProps> = ({
  file,
  isSelected,
  viewMode,
  onSelect,
  onPreview,
  onDownload,
  onAction
}) => {
  const [imageError, setImageError] = useState(false)

  // Obter ícone do arquivo
  const getFileIcon = () => {
    switch (file.file_type) {
      case 'image':
        return <Image className="w-8 h-8 text-blue-500" />
      case 'video':
        return <Video className="w-8 h-8 text-purple-500" />
      case 'audio':
        return <Music className="w-8 h-8 text-green-500" />
      default:
        return <FileText className="w-8 h-8 text-gray-500" />
    }
  }

  // Renderizar preview da imagem
  const renderPreview = () => {
    if (file.file_type === 'image' && file.preview_url && !imageError) {
      return (
        <img
          src={file.preview_url}
          alt={file.original_filename}
          className="w-full h-32 object-cover rounded-lg"
          onError={() => setImageError(true)}
        />
      )
    }

    return (
      <div className="w-full h-32 bg-gray-100 rounded-lg flex items-center justify-center">
        {getFileIcon()}
      </div>
    )
  }

  if (viewMode === 'grid') {
    return (
      <div
        className={`relative bg-white border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer ${
          isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
        }`}
        onClick={() => onPreview(file)}
      >
        {/* Checkbox de seleção */}
        <div className="absolute top-2 left-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSelect(file.id, !isSelected)
            }}
            className="p-1 bg-white rounded shadow-sm hover:bg-gray-50"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-blue-600" />
            ) : (
              <Square className="w-4 h-4 text-gray-400" />
            )}
          </button>
        </div>

        {/* Menu de ações */}
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAction(file)
            }}
            className="p-1 bg-white rounded shadow-sm hover:bg-gray-50"
          >
            <MoreHorizontal className="w-4 h-4 text-gray-600" />
          </button>
        </div>

        {/* Preview */}
        <div className="mb-3">
          {renderPreview()}
        </div>

        {/* Informações */}
        <div className="space-y-2">
          <h4 className="font-medium text-gray-900 truncate text-sm">
            {file.original_filename}
          </h4>
          
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>{mediaLibraryApi.formatFileSize(file.file_size)}</span>
            <span>{mediaLibraryApi.formatRelativeDate(file.created_at)}</span>
          </div>
        </div>

        {/* Ações rápidas */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPreview(file)
            }}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
          >
            <Eye className="w-3 h-3" />
            Ver
          </button>
          
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDownload(file)
            }}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs text-gray-600 hover:text-green-600 hover:bg-green-50 rounded"
          >
            <Download className="w-3 h-3" />
            Baixar
          </button>
        </div>
      </div>
    )
  }

  // Modo lista
  return (
    <div
      className={`flex items-center gap-4 p-4 bg-white border rounded-lg hover:shadow-sm transition-shadow cursor-pointer ${
        isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
      }`}
      onClick={() => onPreview(file)}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onSelect(file.id, !isSelected)
        }}
        className="flex-shrink-0"
      >
        {isSelected ? (
          <CheckSquare className="w-5 h-5 text-blue-600" />
        ) : (
          <Square className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {/* Ícone/Preview */}
      <div className="flex-shrink-0">
        {file.file_type === 'image' && file.preview_url && !imageError ? (
          <img
            src={file.preview_url}
            alt={file.original_filename}
            className="w-12 h-12 object-cover rounded"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center">
            {getFileIcon()}
          </div>
        )}
      </div>

      {/* Informações */}
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-gray-900 truncate">
          {file.original_filename}
        </h4>
        <div className="flex items-center gap-4 text-sm text-gray-500 mt-1">
          <div className="flex items-center gap-1">
            <HardDrive className="w-4 h-4" />
            {mediaLibraryApi.formatFileSize(file.file_size)}
          </div>
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {mediaLibraryApi.formatRelativeDate(file.created_at)}
          </div>
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPreview(file)
          }}
          className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded"
        >
          <Eye className="w-4 h-4" />
        </button>
        
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDownload(file)
          }}
          className="p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded"
        >
          <Download className="w-4 h-4" />
        </button>
        
        <button
          onClick={(e) => {
            e.stopPropagation()
            onAction(file)
          }}
          className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const FileGrid: React.FC<FileGridProps> = ({
  files,
  selectedFiles,
  viewMode,
  loading,
  onFileSelect,
  onSelectAll
}) => {
  const [previewFile, setPreviewFile] = useState<MediaFileExtended | null>(null)

  // Handlers
  const handlePreview = (file: MediaFileExtended) => {
    setPreviewFile(file)
  }

  const handleDownload = (file: MediaFileExtended) => {
    if (file.preview_url) {
      const link = document.createElement('a')
      link.href = file.preview_url
      link.download = file.original_filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const handleAction = (file: MediaFileExtended) => {
    // TODO: Implementar menu de contexto
    console.log('Ações para arquivo:', file.original_filename)
  }

  const handleSelectAll = () => {
    const allSelected = selectedFiles.length === files.length
    onSelectAll(!allSelected)
  }

  // Loading state
  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8">
        <div className="flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-3" />
            <p className="text-gray-500">Carregando arquivos...</p>
          </div>
        </div>
      </div>
    )
  }

  // Empty state
  if (files.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-8">
        <div className="text-center">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Nenhum arquivo encontrado
          </h3>
          <p className="text-gray-500 mb-4">
            Esta pasta está vazia ou não há arquivos que correspondam aos filtros aplicados.
          </p>
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            Fazer Upload
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header com seleção */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={handleSelectAll}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
            >
              {selectedFiles.length === files.length ? (
                <CheckSquare className="w-4 h-4 text-blue-600" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              Selecionar todos
            </button>
            
            {selectedFiles.length > 0 && (
              <span className="text-sm text-gray-500">
                {selectedFiles.length} de {files.length} selecionados
              </span>
            )}
          </div>

          <div className="text-sm text-gray-500">
            {files.length} arquivo{files.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Grid/Lista de arquivos */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {files.map(file => (
              <FileItem
                key={file.id}
                file={file}
                isSelected={selectedFiles.includes(file.id)}
                viewMode={viewMode}
                onSelect={onFileSelect}
                onPreview={handlePreview}
                onDownload={handleDownload}
                onAction={handleAction}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {files.map(file => (
              <FileItem
                key={file.id}
                file={file}
                isSelected={selectedFiles.includes(file.id)}
                viewMode={viewMode}
                onSelect={onFileSelect}
                onPreview={handlePreview}
                onDownload={handleDownload}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal de preview */}
      {previewFile && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">
                {previewFile.original_filename}
              </h3>
              <button
                onClick={() => setPreviewFile(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            
            <div className="p-4">
              {previewFile.file_type === 'image' && previewFile.preview_url ? (
                <img
                  src={previewFile.preview_url}
                  alt={previewFile.original_filename}
                  className="max-w-full max-h-[60vh] object-contain mx-auto"
                />
              ) : (
                <div className="flex items-center justify-center h-64">
                  <div className="text-center">
                    {getFileIcon()}
                    <p className="mt-4 text-gray-500">
                      Preview não disponível para este tipo de arquivo
                    </p>
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-between p-4 border-t border-gray-200 bg-gray-50">
              <div className="text-sm text-gray-600">
                {mediaLibraryApi.formatFileSize(previewFile.file_size)} • {mediaLibraryApi.formatRelativeDate(previewFile.created_at)}
              </div>
              <button
                onClick={() => handleDownload(previewFile)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Baixar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Função auxiliar para ícone de arquivo (fora do componente para evitar recriação)
const getFileIcon = () => <FileText className="w-16 h-16 text-gray-300" />
