// =====================================================
// MEDIA LIBRARY TAB NEW - COMPONENTE NOVO COM SELETOR
// =====================================================
// Componente completamente novo para contornar cache Vercel
// VERSÃO NEW - 10/01/2026 10:52 - COMPONENTE ÚNICO
// Mantém antigo como backup até confirmação de funcionamento

import React, { useState, useEffect } from 'react'
import { mediaLibraryApi, MediaSummary, MediaFile, CompanyFolder } from '../../../services/mediaLibraryApi'

// =====================================================
// INTERFACES
// =====================================================

interface MediaLibraryTabNewProps {
  conversationId: string
  companyId: string
  leadId?: string
}

// =====================================================
// COMPONENTE PRINCIPAL NOVO
// =====================================================

export const MediaLibraryTabNew: React.FC<MediaLibraryTabNewProps> = ({
  conversationId,
  companyId,
  leadId
}) => {
  const [loading, setLoading] = useState(true)
  const [mediaSummary, setMediaSummary] = useState<MediaSummary>({
    images: 0,
    videos: 0,
    audios: 0,
    documents: 0,
    total: 0
  })
  const [recentMedia, setRecentMedia] = useState<MediaFile[]>([])
  const [companyFolders, setCompanyFolders] = useState<CompanyFolder[]>([])
  const [showUploadModalNew, setShowUploadModalNew] = useState(false)
  const [selectedFilesNew, setSelectedFilesNew] = useState<File[]>([])
  const [selectedFolderIdNew, setSelectedFolderIdNew] = useState<string | null>(null)
  const [uploadingNew, setUploadingNew] = useState(false)
  
  // Estados para editar/excluir pastas
  const [showEditModal, setShowEditModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [selectedFolder, setSelectedFolder] = useState<CompanyFolder | null>(null)
  const [editFolderName, setEditFolderName] = useState('')
  const [editFolderIcon, setEditFolderIcon] = useState('')
  const [editFolderDescription, setEditFolderDescription] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

  console.log('🔥🔥🔥 COMPONENTE NOVO CARREGADO - 2026-01-10 10:52 🔥🔥🔥')

  // =====================================================
  // BUSCAR DADOS
  // =====================================================

  const fetchMediaData = async () => {
    try {
      setLoading(true)
      
      if (!companyId) {
        console.log('⚠️ companyId não disponível ainda')
        return
      }

      console.log('📊 NOVO - Carregando dados da biblioteca de mídia...')
      
      // Buscar pastas da empresa primeiro
      const folders = await mediaLibraryApi.getCompanyFolders(companyId)
      setCompanyFolders(folders)
      
      // Buscar resumo de mídias do lead
      const summary = await mediaLibraryApi.getLeadMediaSummary(leadId, companyId)
      setMediaSummary(summary)
      
      // Buscar arquivos recentes do S3 (primeiros 5)
      try {
        console.log('📱 NOVO - Buscando arquivos do S3 para exibição visual...')
        
        const chatFolder = folders.find(folder => folder.name.toLowerCase() === 'chat')
        if (chatFolder) {
          console.log('💬 NOVO - Pasta Chat encontrada, buscando arquivos do S3...')
          const chatFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
            page: 1,
            limit: 5,
            folderId: chatFolder.id
          })
          setRecentMedia(chatFiles.files)
          console.log('✅ NOVO - Arquivos do S3 carregados para interface:', chatFiles.files.length)
        } else {
          console.log('⚠️ NOVO - Pasta Chat não encontrada, usando busca geral')
          const recentFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
            page: 1,
            limit: 5
          })
          setRecentMedia(recentFiles.files)
        }
      } catch (error) {
        console.error('❌ NOVO - Erro ao buscar arquivos do S3:', error)
        setRecentMedia([])
      }
      
    } catch (error) {
      console.error('❌ NOVO - Erro ao carregar dados:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (conversationId && companyId && leadId) {
      fetchMediaData()
    }
  }, [conversationId, companyId, leadId])

  // =====================================================
  // HANDLERS
  // =====================================================

  const handleUploadClickNew = () => {
    console.log('🔥 NOVO - Abrindo modal de upload com seletor de pasta')
    setShowUploadModalNew(true)
    setSelectedFilesNew([])
    setSelectedFolderIdNew(null)
  }

  const handleFileClick = (file: MediaFile) => {
    console.log('📁 NOVO - Arquivo clicado:', file.original_filename)
  }

  const handleSendToChat = (file: MediaFile) => {
    console.log('📤 NOVO - Enviando arquivo para chat:', file.original_filename)
  }

  // =====================================================
  // HANDLERS PARA EDITAR/EXCLUIR PASTAS
  // =====================================================

  const handleEditFolder = (folder: CompanyFolder) => {
    console.log('✏️ Editando pasta:', folder.name)
    setSelectedFolder(folder)
    setEditFolderName(folder.name)
    setEditFolderIcon(folder.icon)
    setEditFolderDescription(folder.description || '')
    setShowEditModal(true)
  }

  const handleDeleteFolder = (folder: CompanyFolder) => {
    console.log('🗑️ Tentando excluir pasta:', folder.name)
    setSelectedFolder(folder)
    setDeleteError(null)
    setShowDeleteModal(true)
  }

  const handleSaveEdit = async () => {
    if (!selectedFolder || !editFolderName.trim()) return

    try {
      console.log('💾 Salvando edição da pasta:', editFolderName)
      
      await mediaLibraryApi.editFolder(companyId, selectedFolder.id, {
        name: editFolderName.trim(),
        icon: editFolderIcon,
        description: editFolderDescription
      })

      // Recarregar lista de pastas
      await fetchMediaData()
      
      // Fechar modal
      setShowEditModal(false)
      setSelectedFolder(null)
      
      console.log('✅ Pasta editada com sucesso')
    } catch (error) {
      console.error('❌ Erro ao editar pasta:', error)
      alert('Erro ao editar pasta: ' + (error as Error).message)
    }
  }

  const handleConfirmDelete = async () => {
    if (!selectedFolder) return

    try {
      console.log('🗑️ Confirmando exclusão da pasta:', selectedFolder.name)
      
      const result = await mediaLibraryApi.deleteFolder(companyId, selectedFolder.id)
      
      if (result.success) {
        // Recarregar lista de pastas
        await fetchMediaData()
        
        // Fechar modal
        setShowDeleteModal(false)
        setSelectedFolder(null)
        setDeleteError(null)
        
        console.log('✅ Pasta excluída com sucesso')
      } else {
        // Mostrar erro específico
        setDeleteError(result.message)
        console.log('❌ Não foi possível excluir:', result.message)
      }
    } catch (error) {
      console.error('❌ Erro ao excluir pasta:', error)
      setDeleteError('Erro de conexão ao excluir pasta')
    }
  }

  if (loading) {
    return (
      <div className="p-4 text-center">
        <div className="text-sm text-gray-500">🔥 NOVO - Carregando biblioteca de mídia...</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header com indicador de componente novo */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">📚 Biblioteca de Mídia</h3>
            <div className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium mt-1">
              🔥 COMPONENTE NOVO - 10:52 - SELETOR DE PASTA
            </div>
          </div>
          <button
            onClick={handleUploadClickNew}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            📤 Upload
          </button>
        </div>
      </div>

      {/* Conteúdo principal */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Seção Mídias do Lead */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700">
              📥 Mídias deste Lead ({mediaSummary.total})
            </h4>
          </div>

          {/* Grid de contadores por tipo */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-blue-50 p-3 rounded-lg text-center">
              <div className="text-lg font-semibold text-blue-700">
                {mediaSummary.images}
              </div>
              <div className="text-xs text-blue-600">🖼️ Imagens</div>
            </div>
            
            <div className="bg-purple-50 p-3 rounded-lg text-center">
              <div className="text-lg font-semibold text-purple-700">
                {mediaSummary.videos}
              </div>
              <div className="text-xs text-purple-600">🎥 Vídeos</div>
            </div>
            
            <div className="bg-green-50 p-3 rounded-lg text-center">
              <div className="text-lg font-semibold text-green-700">
                {mediaSummary.audios}
              </div>
              <div className="text-xs text-green-600">🎵 Áudios</div>
            </div>
            
            <div className="bg-orange-50 p-3 rounded-lg text-center">
              <div className="text-lg font-semibold text-orange-700">
                {mediaSummary.documents}
              </div>
              <div className="text-xs text-orange-600">📄 Docs</div>
            </div>
          </div>

          {/* Grid visual de thumbnails */}
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-gray-600 uppercase tracking-wide">
              Recebidos Recentemente
            </h5>
            
            {recentMedia.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <div className="mb-2">📂</div>
                <div>Nenhuma mídia recebida ainda</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {recentMedia.map(file => (
                  <div 
                    key={file.id}
                    className="relative group bg-gray-50 rounded-lg overflow-hidden hover:bg-gray-100 cursor-pointer transition-all duration-200 hover:shadow-md"
                    onClick={() => handleFileClick(file)}
                  >
                    {/* Thumbnail da imagem */}
                    <div className="aspect-square relative">
                      {file.file_type === 'image' ? (
                        <img
                          src={file.preview_url || file.s3_key ? `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${file.s3_key}` : '/placeholder-image.png'}
                          alt={file.original_filename}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                            const nextElement = e.currentTarget.nextElementSibling as HTMLElement
                            if (nextElement) {
                              nextElement.style.display = 'flex'
                            }
                          }}
                        />
                      ) : null}
                      
                      {/* Fallback para ícone quando não é imagem ou erro */}
                      <div 
                        className={`w-full h-full flex items-center justify-center ${file.file_type === 'image' ? 'hidden' : 'flex'}`}
                        style={{ display: file.file_type === 'image' ? 'none' : 'flex' }}
                      >
                        <div className="text-4xl opacity-60">
                          {mediaLibraryApi.getFileIcon(file.file_type, file.mime_type)}
                        </div>
                      </div>
                      
                      {/* Overlay com tipo de arquivo */}
                      <div className="absolute top-1 left-1">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-black bg-opacity-60 text-white">
                          {file.file_type.toUpperCase()}
                        </span>
                      </div>
                      
                      {/* Overlay hover com ações */}
                      <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSendToChat(file)
                          }}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-xs font-medium hover:bg-blue-700 transition-colors"
                        >
                          Enviar
                        </button>
                      </div>
                    </div>
                    
                    {/* Info do arquivo */}
                    <div className="p-2">
                      <div className="text-xs font-medium text-gray-900 truncate">
                        {file.original_filename}
                      </div>
                      <div className="text-xs text-gray-500">
                        {new Date(file.received_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Seção Pastas da Empresa */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-700">
            📁 Pastas da Empresa ({companyFolders.length})
          </h4>
          
          <div className="space-y-2">
            {companyFolders.map(folder => (
              <div
                key={folder.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group"
              >
                <div className="flex items-center space-x-3 flex-1 cursor-pointer">
                  <span className="text-lg">{folder.icon}</span>
                  <div>
                    <div className="font-medium text-gray-900">{folder.name}</div>
                    <div className="text-xs text-gray-500">
                      {folder.file_count || 0} arquivos • {folder.description}
                    </div>
                  </div>
                </div>
                
                {/* Botões de ação - aparecem no hover */}
                <div className="flex items-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleEditFolder(folder)
                    }}
                    className="p-1.5 text-blue-600 hover:bg-blue-100 rounded-md transition-colors"
                    title="Editar pasta"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteFolder(folder)
                    }}
                    className="p-1.5 text-red-600 hover:bg-red-100 rounded-md transition-colors"
                    title="Excluir pasta"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                  
                  <svg className="w-4 h-4 text-gray-400 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* MODAL NOVO COM SELETOR DE PASTA - DESTAQUE MÁXIMO */}
      {showUploadModalNew && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Upload de Arquivos</h3>
                <div className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium mt-1">
                  🔥 MODAL NOVO - 10:52 - SELETOR DE PASTA ATIVO
                </div>
              </div>
              <button
                onClick={() => setShowUploadModalNew(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* SELETOR DE PASTA - DESTAQUE VERDE */}
              <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4">
                <label className="block text-sm font-bold text-green-800 mb-2">
                  📁 PASTA DE DESTINO (OBRIGATÓRIO) - NOVO COMPONENTE
                </label>
                <select
                  value={selectedFolderIdNew || ''}
                  onChange={(e) => {
                    setSelectedFolderIdNew(e.target.value)
                    console.log('🔥 NOVO - Pasta selecionada:', e.target.value)
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
                {!selectedFolderIdNew && (
                  <div className="text-xs text-green-600 mt-1 font-bold">
                    ⚠️ ESCOLHA ONDE SALVAR: CHAT, MARKETING OU TESTE
                  </div>
                )}
              </div>

              {/* Seletor de Arquivos */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  📤 Arquivos
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-green-400 transition-colors">
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                    onChange={(e) => {
                      const files = e.target.files
                      if (files && files.length > 0) {
                        setSelectedFilesNew(Array.from(files))
                        console.log('🔥 NOVO - Arquivos selecionados:', files.length)
                      }
                    }}
                    className="hidden"
                    id="file-upload-new"
                  />
                  <label htmlFor="file-upload-new" className="cursor-pointer">
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
              {selectedFilesNew.length > 0 && (
                <div className="bg-gray-50 rounded-lg p-3">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">
                    📋 Arquivos selecionados ({selectedFilesNew.length})
                  </h4>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {selectedFilesNew.map((file, index) => (
                      <div key={index} className="flex items-center justify-between bg-white px-3 py-2 rounded border">
                        <div className="flex items-center space-x-2">
                          <span className="text-lg">
                            {file.type.startsWith('image/') ? '🖼️' : 
                             file.type.startsWith('video/') ? '🎥' : 
                             file.type.startsWith('audio/') ? '🎵' : '📄'}
                          </span>
                          <div>
                            <div className="text-sm font-medium text-gray-900 truncate max-w-32">
                              {file.name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedFilesNew(files => files.filter((_, i) => i !== index))
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
                onClick={() => setShowUploadModalNew(false)}
                disabled={uploadingNew}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (selectedFilesNew.length === 0) {
                    alert('Selecione pelo menos um arquivo')
                    return
                  }
                  if (!selectedFolderIdNew) {
                    alert('Selecione a pasta de destino')
                    return
                  }

                  console.log('🚀 NOVO - Iniciando upload:', {
                    files: selectedFilesNew.length,
                    folder: selectedFolderIdNew,
                    company: companyId
                  })

                  setUploadingNew(true)
                  try {
                    for (const file of selectedFilesNew) {
                      const formData = new FormData()
                      formData.append('file', file)
                      formData.append('company_id', companyId)
                      formData.append('folder_id', selectedFolderIdNew)

                      const response = await fetch('/api/media-library/upload-to-folder', {
                        method: 'POST',
                        body: formData
                      })

                      if (!response.ok) {
                        throw new Error(`Erro no upload: ${response.statusText}`)
                      }
                    }
                    
                    fetchMediaData()
                    setShowUploadModalNew(false)
                    setSelectedFilesNew([])
                    setSelectedFolderIdNew(null)
                    console.log('✅ NOVO - Upload concluído com sucesso')
                  } catch (error) {
                    console.error('❌ NOVO - Erro no upload:', error)
                    alert('Erro ao fazer upload dos arquivos. Tente novamente.')
                  } finally {
                    setUploadingNew(false)
                  }
                }}
                disabled={uploadingNew || selectedFilesNew.length === 0 || !selectedFolderIdNew}
                className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadingNew ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Enviando...</span>
                  </div>
                ) : (
                  `🔥 ENVIAR NOVO ${selectedFilesNew.length > 0 ? `(${selectedFilesNew.length})` : ''}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE EDIÇÃO DE PASTA */}
      {showEditModal && selectedFolder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">✏️ Editar Pasta</h3>
              <button
                onClick={() => setShowEditModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              {/* Nome da pasta */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome da pasta *
                </label>
                <input
                  type="text"
                  value={editFolderName}
                  onChange={(e) => setEditFolderName(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Digite o nome da pasta"
                />
              </div>

              {/* Ícone da pasta */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ícone
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {['📁', '📂', '📢', '📦', '📄', '📋', '🎨', '🎬', '📷', '💰'].map(icon => (
                    <button
                      key={icon}
                      onClick={() => setEditFolderIcon(icon)}
                      className={`p-2 text-lg border rounded-md hover:bg-gray-50 ${
                        editFolderIcon === icon ? 'border-blue-500 bg-blue-50' : 'border-gray-300'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>

              {/* Descrição */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição
                </label>
                <textarea
                  value={editFolderDescription}
                  onChange={(e) => setEditFolderDescription(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={2}
                  placeholder="Descrição opcional da pasta"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={!editFolderName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO */}
      {showDeleteModal && selectedFolder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">🗑️ Excluir Pasta</h3>
              <button
                onClick={() => setShowDeleteModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-4">
              <div className="flex items-center space-x-3 mb-3">
                <span className="text-2xl">{selectedFolder.icon}</span>
                <div>
                  <div className="font-medium text-gray-900">{selectedFolder.name}</div>
                  <div className="text-sm text-gray-500">{selectedFolder.description}</div>
                </div>
              </div>

              {deleteError ? (
                <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                  <div className="flex items-start space-x-2">
                    <svg className="w-5 h-5 text-red-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <div className="text-sm font-medium text-red-800">Não é possível excluir</div>
                      <div className="text-sm text-red-700 mt-1">{deleteError}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4">
                  <div className="flex items-start space-x-2">
                    <svg className="w-5 h-5 text-yellow-500 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div>
                      <div className="text-sm font-medium text-yellow-800">Atenção</div>
                      <div className="text-sm text-yellow-700 mt-1">
                        Esta ação não pode ser desfeita. A pasta será excluída permanentemente.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancelar
              </button>
              {!deleteError && (
                <button
                  onClick={handleConfirmDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                >
                  Excluir Pasta
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MediaLibraryTabNew
