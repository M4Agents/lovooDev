// =====================================================
// MEDIA LIBRARY TAB - COMPONENTE ISOLADO
// =====================================================
// Nova aba para biblioteca de mídia na sidebar direita
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
  const [activeSection, setActiveSection] = useState<'lead' | 'company'>('lead')
  const [searchQuery, setSearchQuery] = useState('')

  // =====================================================
  // BUSCAR DADOS (MOCK INICIAL)
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
            companyFolders.map(folder => (
              <div 
                key={folder.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
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
                <ChevronRightIcon className="w-4 h-4 text-gray-400" />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Ações da biblioteca */}
      <div className="space-y-2 border-t border-gray-200 pt-4">
        <button className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
          📤 Upload Arquivo
        </button>
        
        <button className="w-full px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
          📁 Nova Pasta
        </button>
      </div>

    </div>
  )
}

export default MediaLibraryTab
