// =====================================================
// FILE GRID SIMPLE - PARA AUTOMAÇÃO
// =====================================================
// Versão simplificada do FileGrid para uso em automação
// Reutiliza código da biblioteca sem complexidade extra

import React from 'react'

interface MediaFile {
  id: string
  original_filename: string
  file_type: 'image' | 'video' | 'audio' | 'document'
  mime_type: string
  file_size: number
  preview_url: string
  s3_key: string
  created_at: string
}

interface FileGridSimpleProps {
  files: MediaFile[]
  selectedFileId?: string
  onFileSelect: (file: MediaFile) => void
}

export const FileGridSimple: React.FC<FileGridSimpleProps> = ({
  files,
  selectedFileId,
  onFileSelect
}) => {
  if (files.length === 0) {
    return (
      <div className="text-center py-8 px-4 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">📭 Nenhum arquivo nesta pasta</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
      {files.map(file => (
        <div
          key={file.id}
          onClick={() => onFileSelect(file)}
          className={`border rounded-lg p-2 cursor-pointer hover:border-blue-300 transition-all ${
            selectedFileId === file.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
          }`}
        >
          {/* Preview */}
          {file.file_type === 'image' && file.preview_url ? (
            <img
              src={file.preview_url}
              alt={file.original_filename}
              className="w-full h-24 object-cover rounded mb-1"
            />
          ) : file.file_type === 'video' && file.preview_url ? (
            <div className="relative w-full h-24 bg-black rounded mb-1 overflow-hidden">
              <video 
                src={file.preview_url}
                className="w-full h-full object-cover"
                preload="metadata"
              />
              {/* Overlay com ícone play */}
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 pointer-events-none">
                <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
                  <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full h-24 bg-gray-100 rounded mb-1 flex items-center justify-center">
              <span className="text-3xl">
                {file.file_type === 'audio' ? '🎵' : '📄'}
              </span>
            </div>
          )}

          {/* Nome do arquivo */}
          <p className="text-xs mt-1 truncate">{file.original_filename}</p>
          
          {/* Indicador de seleção */}
          {selectedFileId === file.id && (
            <p className="text-xs text-blue-600 mt-1 font-medium">✅ Selecionado</p>
          )}
        </div>
      ))}
    </div>
  )
}
