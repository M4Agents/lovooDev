// =====================================================
// MEDIA LIBRARY TAB - COMPONENTE ISOLADO - v4.0 SUBPASTAS
// =====================================================
// Nova aba para biblioteca de mídia na sidebar direita
// VERSÃO 4.0 - SISTEMA DE SUBPASTAS IMPLEMENTADO - 04/01/2026 12:35
// Implementação cautelosa sem quebrar sistema existente

import React, { useState, useEffect } from 'react'
import { mediaLibraryApi, MediaSummary, MediaFile, CompanyFolder } from '../../../services/mediaLibraryApi'

// =====================================================
// INTERFACES
// =====================================================

interface MediaLibraryTabProps {
  conversationId: string
  companyId: string
  leadId?: string
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const MediaLibraryTab: React.FC<MediaLibraryTabProps> = ({
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
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null)
  const [newFolderDescription, setNewFolderDescription] = useState('')
  const [newFolderIcon, setNewFolderIcon] = useState('📁')
  const [uploading, setUploading] = useState(false)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<CompanyFolder[]>([])
  const [chatMedia, setChatMedia] = useState<MediaFile[]>([])
  const [loadingChatMedia, setLoadingChatMedia] = useState(false)

  // =====================================================
  // BUSCAR DADOS E HELPERS
  // =====================================================

  const fetchMediaData = async () => {
    try {
      setLoading(true)
      
      if (!companyId) {
        console.log('⚠️ companyId não disponível ainda')
        return
      }

      console.log('📊 Dados disponíveis:', { leadId, companyId, conversationId })

      console.log('📊 Carregando dados da biblioteca de mídia...')
      
      // Buscar pastas da empresa primeiro
      const folders = await mediaLibraryApi.getCompanyFolders(companyId)
      setCompanyFolders(folders)
      
      // Buscar resumo de mídias do lead
      const summary = await mediaLibraryApi.getLeadMediaSummary(leadId, companyId)
      setMediaSummary(summary)
      
      // Buscar arquivos recentes do S3 (primeiros 5)
      try {
        console.log('📱 Buscando arquivos do S3 para exibição visual...')
        
        // Tentar buscar da pasta Chat que tem os dados reais do S3
        const chatFolder = folders.find(folder => folder.name.toLowerCase() === 'chat')
        if (chatFolder) {
          console.log('💬 Pasta Chat encontrada, buscando arquivos do S3...')
          const chatFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
            page: 1,
            limit: 5,
            folderId: chatFolder.id
          })
          setRecentMedia(chatFiles.files)
          console.log('✅ Arquivos do S3 carregados para interface:', chatFiles.files.length)
        } else {
          console.log('⚠️ Pasta Chat não encontrada, usando busca geral')
          // Fallback: buscar arquivos gerais
          const recentFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
            page: 1,
            limit: 5
          })
          setRecentMedia(recentFiles.files)
        }
      } catch (s3Error) {
        console.log('⚠️ Erro ao buscar S3, usando fallback:', s3Error)
        const recentFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
          page: 1,
          limit: 5
        })
        setRecentMedia(recentFiles.files)
      }
      
    } catch (error) {
      console.error('❌ Erro ao carregar dados da biblioteca:', error)
    } finally {
      setLoading(false)
    }
  }

  // Helper para organizar pastas em estrutura hierárquica
  const organizeHierarchicalFolders = (folders: CompanyFolder[]): CompanyFolder[] => {
    const rootFolders = folders.filter(folder => !folder.parent_id)
    const childFolders = folders.filter(folder => folder.parent_id)
    
    const addChildren = (folder: CompanyFolder): CompanyFolder & { children?: CompanyFolder[] } => {
      const children = childFolders
        .filter(child => child.parent_id === folder.id)
        .map(addChildren)
      
      return children.length > 0 ? { ...folder, children } : folder
    }
    
    return rootFolders.map(addChildren)
  }

  // Helper para renderizar pasta com indentação
  const renderFolderWithIndentation = (
    folder: CompanyFolder & { children?: CompanyFolder[] }, 
    level: number = 0
  ): React.ReactNode[] => {
    const elements: React.ReactNode[] = []
    
    // Renderizar pasta atual
    elements.push(
      <div 
        key={folder.id}
        className={`flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors ${
          level > 0 ? 'ml-' + (level * 4) : ''
        }`}
        style={{ marginLeft: level * 16 }} // Indentação manual para melhor controle
        onClick={() => handleFolderClick(folder)}
      >
        <div className="flex items-center space-x-3">
          <span className="text-lg">{folder.icon}</span>
          <div>
            <div className="font-medium text-gray-900">{folder.name}</div>
            <div className="text-xs text-gray-500">
              {folder.file_count || 0} arquivos • {folder.description}
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {folder.children && folder.children.length > 0 && (
            <span className="text-xs text-gray-400">
              {folder.children.length} subpasta{folder.children.length > 1 ? 's' : ''}
            </span>
          )}
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    )
    
    // Renderizar subpastas recursivamente
    if (folder.children) {
      folder.children.forEach(child => {
        elements.push(...renderFolderWithIndentation(child, level + 1))
      })
    }
    
    return elements
  }

  useEffect(() => {
    if (conversationId && companyId && leadId) {
      fetchMediaData()
    }
  }, [conversationId, companyId, leadId])

  // =====================================================
  // HANDLERS
  // =====================================================

  const handleFileClick = (file: MediaFile) => {
    console.log('📁 Arquivo clicado:', file.original_filename)
    // TODO: Implementar preview do arquivo
  }

  const handleSendToChat = (file: MediaFile) => {
    console.log('📤 Enviando arquivo para chat:', file.original_filename)
    // TODO: Implementar envio para chat
  }

  const handleSearchChange = (query: string) => {
    setSearchQuery(query)
    // TODO: Implementar busca em tempo real
  }

  const handleUploadClick = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt'
    input.onchange = handleFileSelect
    input.click()
  }

  const handleFileSelect = async (event: Event) => {
    const target = event.target as HTMLInputElement
    const files = target.files
    if (!files || files.length === 0) return

    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        await uploadFile(file)
      }
      // Recarregar dados após upload
      await fetchMediaData()
    } catch (error) {
      console.error('❌ Erro no upload:', error)
      alert('Erro ao fazer upload dos arquivos. Tente novamente.')
    } finally {
      setUploading(false)
    }
  }

  const uploadFile = async (file: File) => {
    // Validações
    const maxSizes = {
      image: 25 * 1024 * 1024, // 25MB
      video: 100 * 1024 * 1024, // 100MB
      audio: 50 * 1024 * 1024, // 50MB
      document: 20 * 1024 * 1024 // 20MB
    }

    const fileType = getFileType(file.type)
    const maxSize = maxSizes[fileType as keyof typeof maxSizes] || maxSizes.document

    if (file.size > maxSize) {
      throw new Error(`Arquivo ${file.name} excede o tamanho máximo permitido`)
    }

    // TODO: Implementar upload real para AWS S3
    console.log('📤 Uploading file:', file.name, 'Type:', fileType, 'Size:', file.size)
    
    // Simular upload por enquanto
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  const getFileType = (mimeType: string): string => {
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    return 'document'
  }

  const handleNewFolderClick = () => {
    console.log('🔍 DEBUG: Abrindo modal Nova Pasta')
    console.log('🔍 DEBUG: companyFolders:', companyFolders)
    console.log('🔍 DEBUG: currentFolderId:', currentFolderId)
    setShowNewFolderModal(true)
    setNewFolderName('')
    setNewFolderParentId(currentFolderId) // Usar pasta atual como pai por padrão
    setNewFolderDescription('')
    setNewFolderIcon('📁')
  }

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      alert('Por favor, digite um nome para a pasta')
      return
    }

    if (!companyId) {
      alert('Erro: ID da empresa não encontrado')
      return
    }

    try {
      await mediaLibraryApi.createFolder(companyId, {
        name: newFolderName.trim(),
        parent_id: newFolderParentId,
        description: newFolderDescription || `Pasta criada pelo usuário`,
        icon: newFolderIcon
      })
      
      setShowNewFolderModal(false)
      setNewFolderName('')
      setNewFolderParentId(null)
      setNewFolderDescription('')
      setNewFolderIcon('📁')
      
      // Recarregar pastas
      await fetchMediaData()
    } catch (error) {
      console.error('❌ Erro ao criar pasta:', error)
      alert('Erro ao criar pasta. Tente novamente.')
    }
  }

  const fetchChatMedia = async (folderId: string) => {
    try {
      setLoadingChatMedia(true)
      console.log('💬 Buscando mídias da pasta Chat via API...')
      
      const response = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
        page: 1,
        limit: 50,
        folderId: folderId
      })
      
      setChatMedia(response.files)
      console.log('✅ Mídias da pasta Chat carregadas:', response.files.length)
    } catch (error) {
      console.error('❌ Erro ao carregar mídias da pasta Chat:', error)
      setChatMedia([])
    } finally {
      setLoadingChatMedia(false)
    }
  }

  const handleFolderClick = (folder: CompanyFolder) => {
    console.log('📁 Navegando para pasta:', folder.name)
    setCurrentFolderId(folder.id)
    
    // Atualizar breadcrumb
    const newBreadcrumb = [...breadcrumb, folder]
    setBreadcrumb(newBreadcrumb)
    
    // Se for pasta Chat, buscar mídias específicas
    if (folder.name.toLowerCase() === 'chat') {
      fetchChatMedia(folder.id)
    }
    
    // Recarregar dados para mostrar conteúdo da pasta
    fetchMediaData()
  }

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      // Voltar para raiz
      setCurrentFolderId(null)
      setBreadcrumb([])
    } else {
      // Navegar para pasta específica no breadcrumb
      const targetFolder = breadcrumb[index]
      setCurrentFolderId(targetFolder.id)
      setBreadcrumb(breadcrumb.slice(0, index + 1))
    }
    fetchMediaData()
  }

  // =====================================================
  // LOADING STATE
  // =====================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Carregando biblioteca...</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // RENDER
  // =====================================================

  return (
    <div className="p-4 space-y-4 h-full overflow-y-auto">
      {/* Header com busca */}
      <div className="space-y-3">
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar arquivos..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <svg 
            className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

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
                          // Fallback para ícone se imagem não carregar
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
                        className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-medium transition-colors"
                      >
                        📤 Enviar
                      </button>
                    </div>
                  </div>
                  
                  {/* Info do arquivo */}
                  <div className="p-2">
                    <p className="text-xs font-medium text-gray-900 truncate">
                      {file.original_filename}
                    </p>
                    <p className="text-xs text-gray-500">
                      {mediaLibraryApi.formatFileSize(file.file_size)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Mídias da Pasta Chat - Exibição Visual */}
      {currentFolderId && chatMedia.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-gray-700 flex items-center">
            <span className="mr-2">💬</span>
            Mídias do WhatsApp ({chatMedia.length})
          </h4>
          
          {loadingChatMedia ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="ml-2 text-sm text-gray-600">Carregando mídias...</span>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {chatMedia.slice(0, 12).map(file => (
                <div 
                  key={file.id}
                  className="relative group bg-gray-50 rounded-lg overflow-hidden hover:bg-gray-100 cursor-pointer transition-all duration-200 hover:shadow-md"
                  onClick={() => handleFileClick(file)}
                >
                  <div className="aspect-square relative">
                    {file.file_type === 'image' ? (
                      <img
                        src={file.preview_url || `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${file.s3_key}`}
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
                    
                    <div 
                      className={`w-full h-full flex items-center justify-center ${file.file_type === 'image' ? 'hidden' : 'flex'}`}
                      style={{ display: file.file_type === 'image' ? 'none' : 'flex' }}
                    >
                      <div className="text-2xl opacity-60">
                        {mediaLibraryApi.getFileIcon(file.file_type, file.mime_type)}
                      </div>
                    </div>
                    
                    <div className="absolute top-1 left-1">
                      <span className="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-black bg-opacity-60 text-white">
                        {file.file_type.toUpperCase()}
                      </span>
                    </div>
                    
                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-40 transition-all duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSendToChat(file)
                        }}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs font-medium transition-colors"
                      >
                        📤
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {chatMedia.length > 12 && (
            <div className="text-center">
              <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                Ver mais {chatMedia.length - 12} mídias
              </button>
            </div>
          )}
        </div>
      )}

      {/* Biblioteca da Empresa */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-700 flex items-center">
          <span className="mr-2">🏢</span>
          Biblioteca da Empresa
        </h4>
        
        <div className="space-y-2">
          {companyFolders.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <div className="mb-2">📁</div>
              <div>Nenhuma pasta criada ainda</div>
            </div>
          ) : (
            <div className="space-y-1">
              {organizeHierarchicalFolders(companyFolders).map(folder => 
                renderFolderWithIndentation(folder)
              )}
            </div>
          )}
        </div>
      </div>

      {/* Ações da biblioteca */}
      <div className="space-y-2 border-t border-gray-200 pt-4">
        <button 
          onClick={handleUploadClick}
          disabled={uploading}
          className={`w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
            uploading 
              ? 'bg-gray-400 text-white cursor-not-allowed' 
              : 'text-white bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {uploading ? '⏳ Enviando...' : '📤 Upload Arquivo'}
        </button>
        
        <button 
          onClick={handleNewFolderClick}
          className="w-full px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
        >
          📁 Nova Pasta
        </button>
      </div>

      {/* Breadcrumb de Navegação */}
      {breadcrumb.length > 0 && (
        <div className="flex items-center space-x-2 text-sm text-gray-600 border-b border-gray-200 pb-2 mb-4">
          <button
            onClick={() => handleBreadcrumbClick(-1)}
            className="hover:text-blue-600 transition-colors"
          >
            📁 Raiz
          </button>
          {breadcrumb.map((folder, index) => (
            <React.Fragment key={folder.id}>
              <span className="text-gray-400">/</span>
              <button
                onClick={() => handleBreadcrumbClick(index)}
                className="hover:text-blue-600 transition-colors"
              >
                {folder.icon} {folder.name}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* Modal Nova Pasta */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-[90vw]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Nova Pasta</h3>
              <div className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium">
                🚀 v4.0 FINAL - 12:35
              </div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <div className="text-sm text-blue-800 font-medium">
                ✅ Sistema de Subpastas Implementado - Versão 4.0
              </div>
              <div className="text-xs text-blue-600 mt-1">
                Agora você pode criar pastas dentro de outras pastas
              </div>
            </div>
            
            <div className="space-y-4">
              {/* Nome da pasta */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Nome da pasta
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Digite o nome da pasta..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && newFolderName.trim()) {
                      handleCreateFolder()
                    }
                  }}
                />
              </div>

              {/* CAMPO PASTA PAI - FUNCIONALIDADE DE SUBPASTAS */}
              <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-orange-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <span className="text-lg mr-2">🎯</span>
                  <label className="block text-sm font-bold text-orange-800">
                    PASTA PAI (OPCIONAL) - CRIAR SUBPASTA
                  </label>
                </div>
                <div className="text-xs text-orange-600 mb-2">
                  Selecione uma pasta existente para criar uma subpasta dentro dela
                </div>
                <select
                  value={newFolderParentId || ''}
                  onChange={(e) => setNewFolderParentId(e.target.value || null)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">📁 Raiz (sem pasta pai)</option>
                  {companyFolders && companyFolders.length > 0 ? (
                    companyFolders
                      .filter(folder => folder.parent_id === null || !folder.parent_id)
                      .map(folder => (
                        <option key={folder.id} value={folder.id}>
                          {folder.icon} {folder.name}
                        </option>
                      ))
                  ) : (
                    <option disabled>Carregando pastas...</option>
                  )}
                </select>
              </div>

              {/* Ícone */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Ícone
                </label>
                <div className="flex space-x-2">
                  {['📁', '📂', '📢', '📦', '📄', '📋', '🎨', '🎬', '📷', '💰'].map(icon => (
                    <button
                      key={icon}
                      onClick={() => setNewFolderIcon(icon)}
                      className={`p-2 text-lg rounded-lg border-2 transition-colors ${
                        newFolderIcon === icon
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
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
                <input
                  type="text"
                  value={newFolderDescription}
                  onChange={(e) => setNewFolderDescription(e.target.value)}
                  placeholder="Descreva o conteúdo da pasta..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => setShowNewFolderModal(false)}
                className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  newFolderName.trim()
                    ? 'text-white bg-blue-600 hover:bg-blue-700'
                    : 'text-gray-400 bg-gray-200 cursor-not-allowed'
                }`}
              >
                Criar Pasta
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default MediaLibraryTab
