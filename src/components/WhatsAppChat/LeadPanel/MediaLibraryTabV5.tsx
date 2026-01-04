// =====================================================
// MEDIA LIBRARY TAB V5 - COMPONENTE SUBPASTAS FINAL
// =====================================================
// VERSÃO 5.0 - SISTEMA DE SUBPASTAS IMPLEMENTADO - 04/01/2026 12:40
// Novo arquivo para forçar invalidação de cache e rebuild completo

import React, { useState, useEffect } from 'react'
import { mediaLibraryApi, MediaSummary, MediaFile, CompanyFolder } from '../../../services/mediaLibraryApi'

// =====================================================
// INTERFACES
// =====================================================

interface MediaLibraryTabV5Props {
  conversationId: string
  companyId: string
  leadId?: string
}

// =====================================================
// COMPONENTE PRINCIPAL V5
// =====================================================

export const MediaLibraryTabV5: React.FC<MediaLibraryTabV5Props> = ({
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
      
      // Buscar resumo de mídias do lead
      const summary = await mediaLibraryApi.getLeadMediaSummary(leadId, companyId)
      setMediaSummary(summary)
      
      // Buscar arquivos recentes (primeiros 5)
      const recentFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
        page: 1,
        limit: 5
      })
      setRecentMedia(recentFiles.files)
      
      // Buscar pastas da empresa
      const folders = await mediaLibraryApi.getCompanyFolders(companyId)
      setCompanyFolders(folders)
      
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
        className={`flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors`}
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
    console.log('🔍 DEBUG V5: Abrindo modal Nova Pasta')
    console.log('🔍 DEBUG V5: companyFolders:', companyFolders)
    console.log('🔍 DEBUG V5: currentFolderId:', currentFolderId)
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

  const handleFolderClick = (folder: CompanyFolder) => {
    console.log('📁 Navegando para pasta:', folder.name)
    setCurrentFolderId(folder.id)
    
    // Atualizar breadcrumb
    const newBreadcrumb = [...breadcrumb, folder]
    setBreadcrumb(newBreadcrumb)
    
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
        <h4 className="text-sm font-medium text-gray-700 flex items-center">
          <span className="mr-2">👤</span>
          Mídias do Lead
        </h4>

        {/* Contadores por tipo */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-blue-50 p-3 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-blue-600">{mediaSummary.images}</div>
              <div className="text-lg">🖼️</div>
            </div>
            <div className="text-xs text-blue-600">📷 Imagens</div>
          </div>
          
          <div className="bg-purple-50 p-3 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-purple-600">{mediaSummary.videos}</div>
              <div className="text-lg">🎥</div>
            </div>
            <div className="text-xs text-purple-600">🎬 Vídeos</div>
          </div>
          
          <div className="bg-green-50 p-3 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-green-600">{mediaSummary.audios}</div>
              <div className="text-lg">🎵</div>
            </div>
            <div className="text-xs text-green-600">🔊 Áudios</div>
          </div>
          
          <div className="bg-orange-50 p-3 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold text-orange-600">{mediaSummary.documents}</div>
              <div className="text-lg">📄</div>
            </div>
            <div className="text-xs text-orange-600">📄 Docs</div>
          </div>
        </div>

        {/* Lista de arquivos recentes */}
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
            <div className="space-y-2">
              {recentMedia.map(file => (
                <div 
                  key={file.id}
                  className="flex items-center space-x-3 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                  onClick={() => handleFileClick(file)}
                >
                  <div className="text-lg">
                    {mediaLibraryApi.getFileIcon(file.file_type, file.mime_type)}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {file.original_filename}
                    </p>
                    <p className="text-xs text-gray-500">
                      {mediaLibraryApi.formatFileSize(file.file_size)} • {mediaLibraryApi.formatRelativeDate(file.received_at)}
                    </p>
                  </div>
                  
                  <button 
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSendToChat(file)
                    }}
                    className="text-blue-600 hover:text-blue-800 text-xs"
                  >
                    Enviar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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

      {/* Modal Nova Pasta V5 - VERSÃO FINAL COM SUBPASTAS */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-[90vw] shadow-2xl">
            {/* Header V5 com identificação única */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Nova Pasta</h3>
              <div className="flex items-center space-x-2">
                <div className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded-full font-bold">
                  🎯 V5.0 FINAL
                </div>
                <div className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium">
                  12:40 ✅
                </div>
              </div>
            </div>

            {/* Banner informativo destacado */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-4 mb-4">
              <div className="flex items-center mb-2">
                <span className="text-xl mr-2">🚀</span>
                <div className="text-sm text-blue-800 font-bold">
                  SISTEMA DE SUBPASTAS ATIVO - VERSÃO 5.0
                </div>
              </div>
              <div className="text-xs text-blue-600">
                Agora você pode criar pastas dentro de outras pastas para melhor organização!
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

              {/* CAMPO PASTA PAI - FUNCIONALIDADE DE SUBPASTAS V5 */}
              <div className="bg-gradient-to-r from-yellow-50 via-orange-50 to-red-50 border-2 border-orange-300 rounded-lg p-4 shadow-inner">
                <div className="flex items-center mb-3">
                  <span className="text-2xl mr-3 animate-pulse">🎯</span>
                  <div>
                    <label className="block text-sm font-black text-orange-900 uppercase tracking-wide">
                      PASTA PAI (OPCIONAL) - CRIAR SUBPASTA
                    </label>
                    <div className="text-xs text-orange-700 font-medium mt-1">
                      Selecione uma pasta existente para criar uma subpasta dentro dela
                    </div>
                  </div>
                </div>
                <select
                  value={newFolderParentId || ''}
                  onChange={(e) => setNewFolderParentId(e.target.value || null)}
                  className="w-full px-3 py-2 border-2 border-orange-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white font-medium"
                >
                  <option value="">📁 Raiz (sem pasta pai) - Pasta principal</option>
                  {companyFolders && companyFolders.length > 0 ? (
                    companyFolders
                      .filter(folder => folder.parent_id === null || !folder.parent_id)
                      .map(folder => (
                        <option key={folder.id} value={folder.id}>
                          {folder.icon} {folder.name} (criar subpasta aqui)
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
                <div className="flex space-x-2 flex-wrap">
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
                  placeholder="Descreva o conteúdo desta pasta..."
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

export default MediaLibraryTabV5
