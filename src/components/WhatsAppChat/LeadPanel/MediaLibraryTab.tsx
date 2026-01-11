// CACHE BYPASS ULTRA V3 - 2026-01-11 12:07 - NOME DE ARQUIVO ÚNICO
// Este arquivo substitui MediaLibraryTab.tsx para quebrar cache do Vercel definitivamente

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Upload, FolderOpen, File, Image, Video, Music, FileText, ChevronRight, Home } from 'lucide-react'
import { mediaLibraryApi } from '@/services/mediaLibraryApi'
import { UploadModalV2 } from './UploadModalV2'

interface MediaFile {
  id: string
  original_filename: string
  file_type: 'image' | 'video' | 'audio' | 'document'
  mime_type: string
  file_size: number
  preview_url?: string
  s3_key: string
  created_at: string
  folder_id?: string
}

interface CompanyFolder {
  id: string
  name: string
  icon: string
  parent_id?: string
  path: string
  created_at: string
}

interface MediaSummary {
  total_files: number
  total_size: number
  by_type: {
    image: number
    video: number
    audio: number
    document: number
  }
}

interface MediaLibraryTabProps {
  leadId: string
  companyId: string
  conversationId?: string
}

export function MediaLibraryTab({ leadId, companyId, conversationId }: MediaLibraryTabProps) {
  console.log('🔥🔥🔥 CACHE BYPASS ULTRA V3 - 2026-01-11 12:07 🔥🔥🔥')
  console.log('📁 ARQUIVO ÚNICO - MediaLibraryTab-cache-bypass-ultra-v3.tsx')
  console.log('⚡ TIMESTAMP DINÂMICO:', new Date().toISOString())
  
  const [loading, setLoading] = useState(true)
  const [recentMedia, setRecentMedia] = useState<MediaFile[]>([])
  const [companyFolders, setCompanyFolders] = useState<CompanyFolder[]>([])
  const [mediaSummary, setMediaSummary] = useState<MediaSummary | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [breadcrumb, setBreadcrumb] = useState<CompanyFolder[]>([])
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [chatMedia, setChatMedia] = useState<MediaFile[]>([])
  const [loadingChatMedia, setLoadingChatMedia] = useState(false)

  const handleFolderClick = (folder: CompanyFolder) => {
    console.log('🔥🔥🔥 CACHE BYPASS ULTRA V3 - FOLDER CLICK 🔥🔥🔥')
    console.log('📁 Navegando para pasta:', folder.name)
    console.log('🆔 DEBUG ULTRA V3 - Definindo currentFolderId para:', folder.id)
    console.log('🔧 VERSÃO ULTRA V3 - fetchMediaDataForFolder será chamada')
    console.log('⚡ Timestamp único:', Date.now())
    
    setCurrentFolderId(folder.id)
    
    // Atualizar breadcrumb
    const newBreadcrumb = [...breadcrumb, folder]
    setBreadcrumb(newBreadcrumb)
    
    // Se for pasta Chat, buscar mídias específicas
    if (folder.name.toLowerCase() === 'chat') {
      fetchChatMedia(folder.id)
    }
    
    // Recarregar dados para mostrar conteúdo da pasta ESPECÍFICA
    console.log('🚀 ULTRA V3 - CHAMANDO fetchMediaDataForFolder com:', { folderId: folder.id, folderName: folder.name })
    fetchMediaDataForFolder(folder.id, folder.name)
  }

  const fetchMediaDataForFolder = async (folderId: string, folderName: string) => {
    try {
      setLoading(true)
      
      if (!companyId) {
        console.log('⚠️ companyId não disponível ainda')
        return
      }

      console.log('🔥🔥🔥 CACHE BYPASS ULTRA V3 - fetchMediaDataForFolder EXECUTANDO 🔥🔥🔥')
      console.log('📂 Carregando dados específicos da pasta:', folderName)
      console.log('🆔 DEBUG ULTRA V3 - folderId recebido:', folderId)
      console.log('⚡ Timestamp único ULTRA V3:', new Date().toISOString())
      console.log('🔧 ARQUIVO ÚNICO V3 - Garantindo reconhecimento pelo Vercel')
      
      // Buscar arquivos específicos da pasta selecionada
      try {
        console.log('🔍 CACHE BYPASS ULTRA V3 - Buscando arquivos da pasta específica:', folderId)
        console.log('🆔 DEBUG ULTRA V3 - Enviando folderId DIRETO para API:', folderId)
        console.log('🔧 VERSÃO ULTRA V3 CORRIGIDA - Parâmetros:', { leadId, companyId, folderId })
        
        const folderFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
          page: 1,
          limit: 20,
          folderId: folderId
        })
        setRecentMedia(folderFiles.files)
        console.log('✅ CACHE BYPASS ULTRA V3 - Arquivos da pasta carregados:', folderFiles.files.length)
        console.log('📋 DEBUG ULTRA V3 - Arquivos encontrados:', folderFiles.files.map(f => f.original_filename))
        console.log('🔍 DEBUG ULTRA V3 - Filtragem por pasta aplicada para:', folderName)
        console.log('🎯 RESULTADO ESPERADO ULTRA V3 - Pasta', folderName, 'deve mostrar apenas seus arquivos')
        
      } catch (folderError) {
        console.error('❌ Erro ao buscar arquivos da pasta:', folderError)
        setRecentMedia([])
      }
      
    } catch (error) {
      console.error('❌ Erro ao carregar dados da pasta:', error)
    } finally {
      setLoading(false)
    }
  }

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
      
      // Buscar arquivos da pasta atual selecionada
      try {
        console.log('📱 Buscando arquivos para exibição visual...')
        console.log('🆔 DEBUG - currentFolderId:', currentFolderId)
        
        // Se há pasta selecionada, buscar arquivos específicos dessa pasta
        if (currentFolderId) {
          const currentFolder = folders.find(folder => folder.id === currentFolderId)
          console.log('📂 Pasta atual selecionada:', currentFolder?.name)
          console.log('🔍 Buscando arquivos da pasta:', currentFolderId)
          console.log('🆔 DEBUG - Enviando folderId para API:', currentFolderId)
          
          const folderFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
            page: 1,
            limit: 20,
            folderId: currentFolderId
          })
          setRecentMedia(folderFiles.files)
          console.log('✅ Arquivos da pasta carregados:', folderFiles.files.length)
          console.log('📋 DEBUG - Arquivos encontrados:', folderFiles.files.map(f => f.original_filename))
          console.log('🔍 DEBUG - Filtragem por pasta aplicada para:', currentFolder?.name)
        } else {
          console.log('📋 Nenhuma pasta selecionada, buscando arquivos gerais')
          // Buscar arquivos gerais quando não há pasta selecionada
          const recentFiles = await mediaLibraryApi.getLeadMediaFiles(leadId, companyId, {
            page: 1,
            limit: 5
          })
          setRecentMedia(recentFiles.files)
          console.log('✅ Arquivos gerais carregados:', recentFiles.files.length)
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

  const fetchChatMedia = async (folderId: string) => {
    try {
      setLoadingChatMedia(true)
      console.log('📱 Buscando mídias específicas da pasta Chat...')
      
      const response = await mediaLibraryApi.getChatMediaFiles(leadId, companyId, {
        page: 1,
        limit: 10,
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

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      // Voltar para raiz
      setCurrentFolderId(null)
      setBreadcrumb([])
      fetchMediaData() // Buscar dados gerais
    } else {
      // Navegar para pasta específica no breadcrumb
      const targetFolder = breadcrumb[index]
      setCurrentFolderId(targetFolder.id)
      setBreadcrumb(breadcrumb.slice(0, index + 1))
      fetchMediaDataForFolder(targetFolder.id, targetFolder.name)
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

  // Renderizar pasta com indentação
  const renderFolder = (folder: CompanyFolder & { children?: CompanyFolder[] }, level = 0) => (
    <div key={folder.id}>
      <div
        className={`flex items-center p-2 hover:bg-gray-50 cursor-pointer rounded-md transition-colors ${
          currentFolderId === folder.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
        } ${
          level > 0 ? 'ml-' + (level * 4) : ''
        }`}
        style={{ marginLeft: level * 16 }} // Indentação manual para melhor controle
        onClick={() => handleFolderClick(folder)}
      >
        <div className="flex items-center space-x-3">
          <span className="text-lg">{folder.icon}</span>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">{folder.name}</p>
            <p className="text-xs text-gray-500">{folder.path}</p>
          </div>
          {folder.children && folder.children.length > 0 && (
            <ChevronRight className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>
      {folder.children && folder.children.map(child => renderFolder(child, level + 1))}
    </div>
  )

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'image':
        return <Image className="h-4 w-4 text-blue-500" />
      case 'video':
        return <Video className="h-4 w-4 text-purple-500" />
      case 'audio':
        return <Music className="h-4 w-4 text-green-500" />
      default:
        return <FileText className="h-4 w-4 text-gray-500" />
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const handleFileSelect = (files: FileList) => {
    console.log('📁 Arquivos selecionados:', files.length)
  }

  const handleUploadSubmit = async (files: File[], selectedFolderId: string) => {
    console.log('🚀 Iniciando upload:', { files: files.length, folderId: selectedFolderId })
  }

  useEffect(() => {
    fetchMediaData()
  }, [leadId, companyId])

  // =====================================================
  // LOADING STATE
  // =====================================================

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600">Carregando biblioteca de mídia...</p>
        </div>
      </div>
    )
  }

  // =====================================================
  // MAIN RENDER
  // =====================================================

  const hierarchicalFolders = organizeHierarchicalFolders(companyFolders)

  return (
    <div className="h-full flex flex-col space-y-6">
      {/* Header com breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => handleBreadcrumbClick(-1)}
            className="flex items-center space-x-1 text-sm text-gray-600 hover:text-gray-900"
          >
            <Home className="h-4 w-4" />
            <span>Início</span>
          </button>
          {breadcrumb.map((folder, index) => (
            <React.Fragment key={folder.id}>
              <ChevronRight className="h-4 w-4 text-gray-400" />
              <button
                onClick={() => handleBreadcrumbClick(index)}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                {folder.name}
              </button>
            </React.Fragment>
          ))}
        </div>
        <Button
          onClick={() => setShowUploadModal(true)}
          className="bg-blue-600 hover:bg-blue-700"
        >
          <Upload className="h-4 w-4 mr-2" />
          Upload
        </Button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sidebar - Pastas */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <FolderOpen className="h-5 w-5" />
                <span>Pastas</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[400px]">
                <div className="space-y-1">
                  {hierarchicalFolders.map(folder => renderFolder(folder))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Main Content - Arquivos */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <File className="h-5 w-5" />
                <span>
                  {currentFolderId 
                    ? `Arquivos - ${companyFolders.find(f => f.id === currentFolderId)?.name || 'Pasta'}`
                    : 'Recebidos Recentemente'
                  }
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentMedia.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recentMedia.map((file) => (
                    <div key={file.id} className="border rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start space-x-3">
                        {getFileIcon(file.file_type)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {file.original_filename}
                          </p>
                          <div className="flex items-center space-x-2 mt-1">
                            <Badge variant="secondary" className="text-xs">
                              {file.file_type}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {formatFileSize(file.file_size)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(file.created_at).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                      </div>
                      {file.preview_url && file.file_type === 'image' && (
                        <div className="mt-3">
                          <img
                            src={file.preview_url}
                            alt={file.original_filename}
                            className="w-full h-32 object-cover rounded-md"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <File className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-500">
                    {currentFolderId 
                      ? 'Nenhum arquivo encontrado nesta pasta'
                      : 'Nenhum arquivo recente encontrado'
                    }
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Modal de Upload */}
      <UploadModalV2
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onFileSelect={handleFileSelect}
        onUploadSubmit={handleUploadSubmit}
        companyId={companyId}
        leadId={leadId}
        folders={companyFolders}
        onUploadComplete={() => {
          fetchMediaData()
          setShowUploadModal(false)
        }}
      />
    </div>
  )
}

export default MediaLibraryTab
