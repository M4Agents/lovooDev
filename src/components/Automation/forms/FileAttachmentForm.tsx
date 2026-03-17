// =====================================================
// COMPONENT: FILE ATTACHMENT FORM
// Data: 17/03/2026 - ATUALIZADO
// Objetivo: Formulário para arquivo anexo
// REUTILIZA: DirectS3Upload, FolderSelector, FileGridSimple
// =====================================================

import { useState, useEffect } from 'react'
import { Upload } from 'lucide-react'
import { DirectS3Upload } from '../../MediaLibrary/DirectS3Upload'
import { FolderSelector } from '../../MediaLibrary/FolderSelector'
import { FileGridSimple } from '../../MediaLibrary/FileGridSimple'
import { mediaManagement } from '../../../services/mediaManagement'

interface Folder {
  id: string
  company_id: string
  name: string
  path: string
  parent_id?: string | null
  icon: string
  description?: string
  file_count?: number
  created_at: string
}

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

interface FileAttachmentFormProps {
  config: {
    fileType?: 'image' | 'document' | 'video'
    fileUrl?: string
    caption?: string
    folderId?: string
    folderName?: string
    libraryFileId?: string
  }
  onChange: (config: any) => void
  companyId: string
}

export default function FileAttachmentForm({ config, onChange, companyId }: FileAttachmentFormProps) {
  const [uploadMode, setUploadMode] = useState<'upload' | 'library'>('upload')
  const [folders, setFolders] = useState<Folder[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState(config.folderId || '')
  const [selectedFolderName, setSelectedFolderName] = useState(config.folderName || '')
  const [libraryFiles, setLibraryFiles] = useState<MediaFile[]>([])
  const [caption, setCaption] = useState(config.caption || '')
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [loadingFiles, setLoadingFiles] = useState(false)

  // Buscar pastas ao montar
  useEffect(() => {
    fetchFolders()
  }, [companyId])

  // Buscar arquivos quando pasta for selecionada (modo biblioteca)
  useEffect(() => {
    if (selectedFolderId && uploadMode === 'library') {
      fetchFolderFiles()
    }
  }, [selectedFolderId, uploadMode])

  const fetchFolders = async () => {
    try {
      setLoadingFolders(true)
      const foldersList = await mediaManagement.getFoldersHierarchy(companyId)
      setFolders(foldersList)
    } catch (error) {
      console.error('Erro ao buscar pastas:', error)
    } finally {
      setLoadingFolders(false)
    }
  }

  const fetchFolderFiles = async () => {
    try {
      setLoadingFiles(true)
      const result = await mediaManagement.getFiles(companyId, {
        folder_id: selectedFolderId,
        page: 1,
        limit: 100
      })
      setLibraryFiles(result.files)
    } catch (error) {
      console.error('Erro ao buscar arquivos:', error)
      setLibraryFiles([])
    } finally {
      setLoadingFiles(false)
    }
  }

  const handleUploadComplete = async (fileId: string) => {
    try {
      // Buscar dados do arquivo recém-uploadado
      const result = await mediaManagement.getFiles(companyId, {
        page: 1,
        limit: 1
      })
      
      if (result.files.length > 0) {
        const file = result.files[0]
        onChange({
          ...config,
          fileUrl: file.preview_url,
          folderId: selectedFolderId,
          folderName: selectedFolderName,
          libraryFileId: file.id,
          fileType: file.file_type
        })
      }
    } catch (error) {
      console.error('Erro ao buscar arquivo uploadado:', error)
    }
  }

  const handleLibraryFileSelect = (file: MediaFile) => {
    onChange({
      ...config,
      fileUrl: file.preview_url,
      folderId: selectedFolderId,
      folderName: selectedFolderName,
      libraryFileId: file.id,
      fileType: file.file_type
    })
  }

  const handleFolderSelect = (folderId: string, folderName: string) => {
    setSelectedFolderId(folderId)
    setSelectedFolderName(folderName)
  }

  return (
    <div className="space-y-4">
      {/* Tabs: Upload Novo vs Biblioteca */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setUploadMode('upload')}
          className={`px-4 py-2 font-medium transition-colors ${
            uploadMode === 'upload'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          📤 Upload Novo
        </button>
        <button
          onClick={() => setUploadMode('library')}
          className={`px-4 py-2 font-medium transition-colors ${
            uploadMode === 'library'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          📚 Da Biblioteca
        </button>
      </div>

      {/* Seletor de Pasta (comum para ambos) */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          📁 {uploadMode === 'upload' ? 'Pasta de Destino' : 'Pasta de Origem'}
        </label>
        {loadingFolders ? (
          <div className="text-center py-4 text-gray-500">Carregando pastas...</div>
        ) : (
          <FolderSelector
            folders={folders}
            selectedFolderId={selectedFolderId}
            onFolderSelect={handleFolderSelect}
          />
        )}
      </div>

      {uploadMode === 'upload' ? (
        /* Upload Novo (REUTILIZA DirectS3Upload) */
        <div>
          {!selectedFolderId ? (
            <div className="text-center py-8 px-4 bg-yellow-50 rounded-lg border border-yellow-200">
              <p className="text-yellow-700 font-medium">⚠️ Selecione uma pasta primeiro</p>
              <p className="text-xs text-yellow-600 mt-1">Escolha onde o arquivo será salvo</p>
            </div>
          ) : (
            <DirectS3Upload
              companyId={companyId}
              folderId={selectedFolderId}
              onUploadComplete={handleUploadComplete}
              showDragDrop={true}
            />
          )}
        </div>
      ) : (
        /* Selecionar da Biblioteca (REUTILIZA FileGridSimple) */
        <div>
          {!selectedFolderId ? (
            <div className="text-center py-8 px-4 bg-purple-50 rounded-lg border border-purple-200">
              <p className="text-2xl mb-2">👆</p>
              <p className="text-purple-700 font-medium">Selecione uma pasta acima</p>
              <p className="text-xs text-purple-600 mt-1">para ver os arquivos disponíveis</p>
            </div>
          ) : loadingFiles ? (
            <div className="text-center py-8 text-gray-500">Carregando arquivos...</div>
          ) : (
            <FileGridSimple
              files={libraryFiles}
              selectedFileId={config.libraryFileId}
              onFileSelect={handleLibraryFileSelect}
            />
          )}
        </div>
      )}

      {/* Preview do arquivo selecionado */}
      {config.fileUrl && (
        <div className="border rounded-lg p-3 bg-green-50 border-green-200">
          <p className="text-sm font-medium text-green-700 mb-2">✅ Arquivo selecionado:</p>
          <div className="flex items-center gap-3">
            {config.fileType === 'image' && (
              <img src={config.fileUrl} className="w-16 h-16 object-cover rounded" alt="Preview" />
            )}
            {config.fileType === 'video' && (
              <div className="w-16 h-16 bg-black rounded flex items-center justify-center">
                <span className="text-2xl">🎬</span>
              </div>
            )}
            {config.fileType === 'document' && (
              <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center">
                <span className="text-2xl">📄</span>
              </div>
            )}
            <div className="flex-1">
              <p className="text-xs text-gray-600">
                📁 Pasta: {config.folderName || 'Sem pasta'}
              </p>
              <p className="text-xs text-gray-600">
                📎 Tipo: {config.fileType || 'Desconhecido'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Legenda */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Legenda (opcional)
        </label>
        <textarea
          value={caption}
          onChange={(e) => {
            setCaption(e.target.value)
            onChange({ ...config, caption: e.target.value })
          }}
          placeholder="Digite uma legenda para o arquivo..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          rows={2}
        />
      </div>
    </div>
  )
}
