// =====================================================
// FILE UPLOAD - UPLOAD AVANÇADO DE ARQUIVOS
// =====================================================
// Componente para upload múltiplo com drag & drop

import React, { useState, useRef, useCallback } from 'react'
import { mediaManagement, FileUploadData } from '../../services/mediaManagement'
import {
  Upload,
  X,
  File,
  Image,
  Video,
  Music,
  CheckCircle,
  AlertCircle,
  Loader2
} from 'lucide-react'

// =====================================================
// INTERFACES
// =====================================================

interface FileUploadProps {
  companyId: string
  currentFolderId?: string
  companyFolders?: Array<{id: string, name: string, icon: string}>
  onClose: () => void
  onComplete: () => void
}

interface UploadFile {
  id: string
  file: File
  status: 'pending' | 'uploading' | 'success' | 'error'
  progress: number
  error?: string
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const FileUpload: React.FC<FileUploadProps> = ({
  companyId,
  currentFolderId,
  companyFolders = [],
  onClose,
  onComplete
}) => {
  const [uploadFiles, setUploadFiles] = useState<UploadFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedFolderId, setSelectedFolderId] = useState<string>(currentFolderId || '')
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // =====================================================
  // VALIDAÇÕES
  // =====================================================

  const validateFile = (file: File): { valid: boolean; error?: string } => {
    // Tamanho máximo por tipo
    const maxSizes = {
      image: 25 * 1024 * 1024, // 25MB
      video: 100 * 1024 * 1024, // 100MB
      audio: 50 * 1024 * 1024, // 50MB
      document: 20 * 1024 * 1024 // 20MB
    }

    // Tipos permitidos
    const allowedTypes = {
      image: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
      video: ['video/mp4', 'video/mov', 'video/avi', 'video/wmv', 'video/flv', 'video/webm'],
      audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/aac'],
      document: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv'
      ]
    }

    // Determinar tipo do arquivo
    let fileType: keyof typeof maxSizes = 'document'
    if (file.type.startsWith('image/')) fileType = 'image'
    else if (file.type.startsWith('video/')) fileType = 'video'
    else if (file.type.startsWith('audio/')) fileType = 'audio'

    // Verificar tipo permitido
    const typeAllowed = allowedTypes[fileType].includes(file.type)
    if (!typeAllowed) {
      return { valid: false, error: `Tipo de arquivo não permitido: ${file.type}` }
    }

    // Verificar tamanho
    const maxSize = maxSizes[fileType]
    if (file.size > maxSize) {
      const maxSizeMB = Math.round(maxSize / (1024 * 1024))
      return { valid: false, error: `Arquivo muito grande. Máximo ${maxSizeMB}MB para ${fileType}s` }
    }

    return { valid: true }
  }

  // =====================================================
  // HANDLERS DE ARQUIVOS
  // =====================================================

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles: UploadFile[] = []
    
    Array.from(files).forEach(file => {
      const validation = validateFile(file)
      
      newFiles.push({
        id: `${Date.now()}-${Math.random()}`,
        file,
        status: validation.valid ? 'pending' : 'error',
        progress: 0,
        error: validation.error
      })
    })

    setUploadFiles(prev => [...prev, ...newFiles])
  }, [])

  const removeFile = (fileId: string) => {
    setUploadFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const clearAll = () => {
    setUploadFiles([])
  }

  // =====================================================
  // DRAG & DROP
  // =====================================================

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const files = e.dataTransfer.files
    if (files.length > 0) {
      addFiles(files)
    }
  }, [addFiles])

  // =====================================================
  // UPLOAD
  // =====================================================

  const uploadFile = async (uploadFile: UploadFile): Promise<void> => {
    try {
      setUploadFiles(prev =>
        prev.map(f =>
          f.id === uploadFile.id
            ? { ...f, status: 'uploading', progress: 0 }
            : f
        )
      )

      // Simular progresso (em implementação real, usar XMLHttpRequest ou similar)
      const progressInterval = setInterval(() => {
        setUploadFiles(prev =>
          prev.map(f =>
            f.id === uploadFile.id && f.progress < 90
              ? { ...f, progress: f.progress + 10 }
              : f
          )
        )
      }, 200)

      // OPÇÃO 1: SEMPRE usar API antiga que funcionava perfeitamente
      console.log('🔄 USANDO API ANTIGA QUE FUNCIONAVA - Upload garantido')
      
      // DEBUG EXTENSIVO
      console.log('🔍 DEBUG COMPLETO - selectedFolderId:', selectedFolderId)
      console.log('🔍 DEBUG COMPLETO - companyId:', companyId)
      console.log('🔍 DEBUG COMPLETO - currentFolderId:', currentFolderId)
      console.log('🔍 DEBUG COMPLETO - arquivo:', uploadFile.file.name)
      
      // Declarar variável uploadResult
      let uploadResult: any
      
      // Se pasta selecionada, usar upload com organização automática
      if (selectedFolderId) {
        console.log('🔄 Upload com organização automática para pasta:', selectedFolderId)
        
        const formData = new FormData()
        formData.append('file', uploadFile.file)
        formData.append('company_id', companyId)
        formData.append('folder_id', selectedFolderId)
        formData.append('organize_to_folder', 'true')
        
        const response = await fetch('/api/media-management/files/upload-cache-bypass-final', {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const data = await response.json()
        uploadResult = data.data
        
        console.log('✅ Upload + organização virtual concluído:', uploadResult.id)
        console.log('📁 Arquivo físico em:', uploadResult.s3_key)
        console.log('📂 Organização virtual:', uploadResult.folder_name)
        console.log('🆔 DEBUG - folder_id enviado:', selectedFolderId)
        console.log('🆔 DEBUG - folder_id no resultado:', uploadResult.folder_id)
        console.log('📋 DEBUG - uploadResult completo:', JSON.stringify(uploadResult, null, 2))
        console.log('🔒 Sistema seguro - sem dependência de MCP ou credenciais temporárias')
        console.log('🚀 Otimizado para escala SaaS - funciona mesmo após expiração de credenciais')
        
      } else {
        // Upload normal sem organização
        const uploadData: FileUploadData = {
          file: uploadFile.file,
          folder_id: currentFolderId,
          tags: undefined
        }

        uploadResult = await mediaManagement.uploadFile(companyId, uploadData)
      }
      
      console.log('✅ Upload bem-sucedido com API antiga:', uploadResult.id)
      console.log('🔍 DEBUG - uploadResult completo:', uploadResult)
      console.log('🔍 DEBUG - uploadResult.s3_key:', uploadResult.s3_key)
      
      // Organização virtual já foi feita na API se pasta foi selecionada
      if (selectedFolderId) {
        console.log('✅ Organização virtual concluída - sistema seguro e independente')
        console.log('📁 Arquivo permanece na estrutura temporal no S3')
        console.log('📂 Organização virtual via interface - sem dependências externas')
        console.log('🔒 Sistema robusto que funciona mesmo após expiração de credenciais')
      } else {
        console.log('📋 Nenhuma pasta selecionada, arquivo fica na estrutura temporal')
      }

      clearInterval(progressInterval)
      
      setUploadFiles(prev =>
        prev.map(f =>
          f.id === uploadFile.id
            ? { ...f, status: 'success', progress: 100 }
            : f
        )
      )

    } catch (error) {
      setUploadFiles(prev =>
        prev.map(f =>
          f.id === uploadFile.id
            ? { ...f, status: 'error', error: error instanceof Error ? error.message : 'Erro no upload' }
            : f
        )
      )
    }
  }

  const startUpload = async () => {
    const validFiles = uploadFiles.filter(f => f.status === 'pending')
    
    if (validFiles.length === 0) {
      return
    }

    setIsUploading(true)

    try {
      // Upload sequencial para evitar sobrecarga
      for (const file of validFiles) {
        await uploadFile(file)
      }

      // Aguardar todos os uploads terminarem e verificar se pelo menos um foi bem-sucedido
      // Precisamos verificar o estado atualizado após todos os uploads
      setTimeout(() => {
        setUploadFiles(prev => {
          const hasSuccess = prev.some(f => f.status === 'success')
          
          if (hasSuccess) {
            console.log('✅ Upload bem-sucedido, chamando onComplete...')
            onComplete() // Chama refresh automático da lista
          } else {
            console.log('❌ Nenhum upload bem-sucedido')
          }
          
          return prev
        })
      }, 500)

    } catch (error) {
      console.error('Erro no upload em lote:', error)
    } finally {
      setIsUploading(false)
    }
  }

  // =====================================================
  // HELPERS DE RENDERIZAÇÃO
  // =====================================================

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return <Image className="w-8 h-8 text-blue-500" />
    if (file.type.startsWith('video/')) return <Video className="w-8 h-8 text-purple-500" />
    if (file.type.startsWith('audio/')) return <Music className="w-8 h-8 text-green-500" />
    return <File className="w-8 h-8 text-gray-500" />
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getStatusIcon = (status: UploadFile['status']) => {
    switch (status) {
      case 'uploading':
        return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return null
    }
  }

  const pendingFiles = uploadFiles.filter(f => f.status === 'pending')
  const hasErrors = uploadFiles.some(f => f.status === 'error')
  const allCompleted = uploadFiles.length > 0 && uploadFiles.every(f => f.status === 'success' || f.status === 'error')

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Upload de Arquivos</h2>
            <div className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium mt-1">
              🔥 MODAL REAL MODIFICADO - 11:16 - SELETOR DE PASTA ATIVO
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Área de upload */}
        <div className="p-6">
          {/* SELETOR DE PASTA - DESTAQUE VERDE */}
          {companyFolders.length > 0 && (
            <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 mb-6">
              <label className="block text-sm font-bold text-green-800 mb-2">
                📁 PASTA DE DESTINO (OBRIGATÓRIO) - MODAL REAL
              </label>
              <select
                value={selectedFolderId}
                onChange={(e) => {
                  setSelectedFolderId(e.target.value)
                  console.log('🔥 MODAL REAL - Pasta selecionada:', e.target.value)
                }}
                className="w-full border-2 border-green-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
              >
                <option value="">🔽 SELECIONE UMA PASTA...</option>
                {companyFolders.map(folder => (
                  <option key={folder.id} value={folder.id}>
                    {folder.icon} {folder.name}
                  </option>
                ))}
              </select>
              {!selectedFolderId && (
                <div className="text-xs text-green-600 mt-1 font-bold">
                  ⚠️ ESCOLHA ONDE SALVAR: CHAT, MARKETING OU TESTE
                </div>
              )}
            </div>
          )}

          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragOver
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-300 hover:border-gray-400'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Arraste arquivos aqui ou clique para selecionar
            </h3>
            <p className="text-gray-600 mb-4">
              Suporte para imagens, vídeos, áudios e documentos
            </p>
            
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Selecionar Arquivos
            </button>
            
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  addFiles(e.target.files)
                }
              }}
            />
          </div>

          {/* Lista de arquivos */}
          {uploadFiles.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-medium text-gray-900">
                  Arquivos ({uploadFiles.length})
                </h4>
                <button
                  onClick={clearAll}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Limpar todos
                </button>
              </div>

              <div className="space-y-3 max-h-64 overflow-y-auto">
                {uploadFiles.map(uploadFile => (
                  <div
                    key={uploadFile.id}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                  >
                    {/* Ícone */}
                    <div className="flex-shrink-0">
                      {getFileIcon(uploadFile.file)}
                    </div>

                    {/* Informações */}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {uploadFile.file.name}
                      </p>
                      <p className="text-sm text-gray-600">
                        {formatFileSize(uploadFile.file.size)}
                      </p>
                      
                      {/* Barra de progresso */}
                      {uploadFile.status === 'uploading' && (
                        <div className="mt-2">
                          <div className="bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${uploadFile.progress}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-600 mt-1">
                            {uploadFile.progress}%
                          </p>
                        </div>
                      )}
                      
                      {/* Erro */}
                      {uploadFile.error && (
                        <p className="text-sm text-red-600 mt-1">
                          {uploadFile.error}
                        </p>
                      )}
                    </div>

                    {/* Status */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {getStatusIcon(uploadFile.status)}
                      
                      {uploadFile.status === 'pending' && (
                        <button
                          onClick={() => removeFile(uploadFile.id)}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-600">
            {pendingFiles.length > 0 && (
              <span>{pendingFiles.length} arquivo(s) prontos para upload</span>
            )}
            {hasErrors && (
              <span className="text-red-600 ml-2">
                Alguns arquivos têm erros
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              {allCompleted ? 'Fechar' : 'Cancelar'}
            </button>
            
            {!allCompleted && (
              <button
                onClick={startUpload}
                disabled={pendingFiles.length === 0 || isUploading}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                  pendingFiles.length > 0 && !isUploading
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isUploading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Enviando...
                  </div>
                ) : (
                  `Enviar ${pendingFiles.length} arquivo(s)`
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
