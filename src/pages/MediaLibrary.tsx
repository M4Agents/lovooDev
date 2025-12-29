// =====================================================
// MEDIA LIBRARY PAGE - GESTÃO COMPLETA DE MÍDIAS
// =====================================================
// Página principal para gestão de mídias da empresa

import React, { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { FolderExplorer } from '../components/MediaLibrary/FolderExplorer'
import { FileGrid } from '../components/MediaLibrary/FileGrid'
import { FileUpload } from '../components/MediaLibrary/FileUpload'
import { FolderManager } from '../components/MediaLibrary/FolderManager'
import { MediaActions } from '../components/MediaLibrary/MediaActions'
import { mediaManagement, MediaFolder, MediaFileExtended } from '../services/mediaManagement'
import {
  Search,
  Upload,
  FolderPlus,
  Grid3X3,
  List,
  SortAsc,
  SortDesc,
  RefreshCw
} from 'lucide-react'

// =====================================================
// INTERFACES
// =====================================================

interface MediaLibraryState {
  folders: MediaFolder[]
  files: MediaFileExtended[]
  currentFolder?: MediaFolder
  selectedFiles: string[]
  loading: boolean
  uploading: boolean
  searchQuery: string
  viewMode: 'grid' | 'list'
  sortBy: 'name' | 'date' | 'size' | 'type'
  sortOrder: 'asc' | 'desc'
  filterType: string
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const MediaLibrary: React.FC = () => {
  const { company } = useAuth()
  const [state, setState] = useState<MediaLibraryState>({
    folders: [],
    files: [],
    selectedFiles: [],
    loading: true,
    uploading: false,
    searchQuery: '',
    viewMode: 'grid',
    sortBy: 'date',
    sortOrder: 'desc',
    filterType: 'all'
  })

  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showFolderModal, setShowFolderModal] = useState(false)
  const [showActionsModal, setShowActionsModal] = useState(false)
  const [breadcrumb, setBreadcrumb] = useState<Array<{ id: string; name: string; path: string }>>([])

  // =====================================================
  // CARREGAR DADOS INICIAIS
  // =====================================================

  const loadData = async () => {
    if (!company?.id) return

    try {
      setState(prev => ({ ...prev, loading: true }))

      // Carregar hierarquia de pastas
      const folders = await mediaManagement.getFoldersHierarchy(company.id)
      
      // Carregar arquivos da pasta atual (raiz se nenhuma selecionada)
      let filesData
      
      // CORREÇÃO CRÍTICA: Verificar se é pasta Chat especificamente
      const isChatFolder = state.currentFolder?.name === 'Chat' || state.currentFolder?.path === '/chat'
      
      if (isChatFolder) {
        console.log('💬 FRONTEND: Detectou pasta Chat, usando API específica')
        try {
          filesData = await mediaManagement.getLeadMediaFiles(undefined, company.id, {
            search: state.searchQuery,
            fileType: state.filterType === 'all' ? undefined : state.filterType as any,
            folderId: state.currentFolder.id
          })
        } catch (error) {
          console.error('❌ Erro na API da pasta Chat, usando fallback:', error)
          // Fallback para pasta Chat: usar API de pastas normal
          filesData = await mediaManagement.getFolderFiles(company.id, state.currentFolder?.id, {
            search: state.searchQuery,
            sortBy: state.sortBy,
            sortOrder: state.sortOrder,
            fileType: state.filterType === 'all' ? undefined : state.filterType
          })
        }
      } else if (state.currentFolder) {
        // Outras pastas: usar API normal
        filesData = await mediaManagement.getFolderFiles(company.id, state.currentFolder?.id, {
          search: state.searchQuery,
          sortBy: state.sortBy,
          sortOrder: state.sortOrder,
          fileType: state.filterType === 'all' ? undefined : state.filterType
        })
      } else {
        // Pasta raiz
        filesData = await mediaManagement.getFolderFiles(company.id, state.currentFolder?.id, {
          search: state.searchQuery,
          sortBy: state.sortBy,
          sortOrder: state.sortOrder,
          fileType: state.filterType === 'all' ? undefined : state.filterType
        })
      }

      setState(prev => ({
        ...prev,
        folders,
        files: filesData.files,
        loading: false
      }))

      // Atualizar breadcrumb
      if (state.currentFolder) {
        const newBreadcrumb = mediaManagement.generateBreadcrumb(state.currentFolder, folders)
        setBreadcrumb(newBreadcrumb)
      } else {
        setBreadcrumb([])
      }

    } catch (error) {
      console.error('❌ Erro ao carregar dados:', error)
      setState(prev => ({ ...prev, loading: false }))
    }
  }

  useEffect(() => {
    loadData()
  }, [company?.id, state.currentFolder?.id, state.searchQuery, state.sortBy, state.sortOrder, state.filterType])

  // =====================================================
  // HANDLERS DE NAVEGAÇÃO
  // =====================================================

  const handleFolderSelect = (folder?: MediaFolder) => {
    setState(prev => ({
      ...prev,
      currentFolder: folder,
      selectedFiles: []
    }))
  }

  const handleBreadcrumbClick = (folderId?: string) => {
    if (!folderId) {
      handleFolderSelect(undefined) // Voltar para raiz
    } else {
      const folder = state.folders.find(f => f.id === folderId)
      if (folder) {
        handleFolderSelect(folder)
      }
    }
  }

  // =====================================================
  // HANDLERS DE BUSCA E FILTROS
  // =====================================================

  const handleSearchChange = (query: string) => {
    setState(prev => ({ ...prev, searchQuery: query }))
  }

  const handleSortChange = (sortBy: 'name' | 'date' | 'size' | 'type') => {
    setState(prev => ({
      ...prev,
      sortBy,
      sortOrder: prev.sortBy === sortBy && prev.sortOrder === 'asc' ? 'desc' : 'asc'
    }))
  }

  const handleFilterChange = (filterType: string) => {
    setState(prev => ({ ...prev, filterType }))
  }

  const handleViewModeChange = (viewMode: 'grid' | 'list') => {
    setState(prev => ({ ...prev, viewMode }))
  }

  // =====================================================
  // HANDLERS DE SELEÇÃO
  // =====================================================

  const handleFileSelect = (fileId: string, selected: boolean) => {
    setState(prev => ({
      ...prev,
      selectedFiles: selected
        ? [...prev.selectedFiles, fileId]
        : prev.selectedFiles.filter(id => id !== fileId)
    }))
  }

  const handleSelectAll = (selectAll: boolean) => {
    setState(prev => ({
      ...prev,
      selectedFiles: selectAll ? prev.files.map(f => f.id) : []
    }))
  }

  // =====================================================
  // HANDLERS DE AÇÕES
  // =====================================================

  const handleUploadComplete = () => {
    setShowUploadModal(false)
    loadData() // Recarregar dados
  }

  const handleFolderCreated = () => {
    setShowFolderModal(false)
    loadData() // Recarregar dados
  }

  const handleActionsComplete = () => {
    setShowActionsModal(false)
    setState(prev => ({ ...prev, selectedFiles: [] }))
    loadData() // Recarregar dados
  }

  const handleRefresh = () => {
    loadData()
  }

  // =====================================================
  // RENDER
  // =====================================================

  if (!company) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-gray-500">Carregando informações da empresa...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Biblioteca de Mídias</h1>
            <p className="text-gray-600">Gerencie todos os arquivos da sua empresa</p>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefresh}
              disabled={state.loading}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-5 h-5 ${state.loading ? 'animate-spin' : ''}`} />
            </button>
            
            <button
              onClick={() => setShowFolderModal(true)}
              className="px-4 py-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-2"
            >
              <FolderPlus className="w-5 h-5" />
              Nova Pasta
            </button>
            
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <Upload className="w-5 h-5" />
              Upload
            </button>
          </div>
        </div>

        {/* Breadcrumb */}
        {breadcrumb.length > 0 && (
          <nav className="flex items-center space-x-2 text-sm text-gray-600">
            <button
              onClick={() => handleBreadcrumbClick()}
              className="hover:text-blue-600 transition-colors"
            >
              Início
            </button>
            {breadcrumb.map((item, index) => (
              <React.Fragment key={item.id}>
                <span>/</span>
                <button
                  onClick={() => handleBreadcrumbClick(item.id)}
                  className={`hover:text-blue-600 transition-colors ${
                    index === breadcrumb.length - 1 ? 'font-medium text-gray-900' : ''
                  }`}
                >
                  {item.name}
                </button>
              </React.Fragment>
            ))}
          </nav>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between bg-white p-4 rounded-lg border border-gray-200">
          {/* Busca */}
          <div className="flex items-center gap-4 flex-1">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              <input
                type="text"
                placeholder="Buscar arquivos..."
                value={state.searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full"
              />
            </div>

            {/* Filtros */}
            <select
              value={state.filterType}
              onChange={(e) => handleFilterChange(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="all">Todos os tipos</option>
              <option value="image">Imagens</option>
              <option value="video">Vídeos</option>
              <option value="audio">Áudios</option>
              <option value="document">Documentos</option>
            </select>
          </div>

          {/* Controles de visualização */}
          <div className="flex items-center gap-2">
            {/* Ordenação */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleSortChange('name')}
                className={`px-2 py-1 text-xs rounded ${
                  state.sortBy === 'name' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Nome
              </button>
              <button
                onClick={() => handleSortChange('date')}
                className={`px-2 py-1 text-xs rounded ${
                  state.sortBy === 'date' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Data
              </button>
              <button
                onClick={() => handleSortChange('size')}
                className={`px-2 py-1 text-xs rounded ${
                  state.sortBy === 'size' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Tamanho
              </button>
              
              <button
                onClick={() => setState(prev => ({ ...prev, sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' }))}
                className="p-1 text-gray-600 hover:bg-gray-100 rounded"
              >
                {state.sortOrder === 'asc' ? <SortAsc className="w-4 h-4" /> : <SortDesc className="w-4 h-4" />}
              </button>
            </div>

            {/* Modo de visualização */}
            <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => handleViewModeChange('grid')}
                className={`p-2 ${
                  state.viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Grid3X3 className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleViewModeChange('list')}
                className={`p-2 ${
                  state.viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Ações em lote */}
        {state.selectedFiles.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-blue-700 font-medium">
                {state.selectedFiles.length} arquivo(s) selecionado(s)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSelectAll(false)}
                  className="px-3 py-1 text-blue-600 hover:text-blue-700 text-sm"
                >
                  Desmarcar todos
                </button>
                <button
                  onClick={() => setShowActionsModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-lg text-sm"
                >
                  Ações em lote
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Conteúdo principal */}
        <div className="grid grid-cols-12 gap-6">
          {/* Sidebar - Explorador de pastas */}
          <div className="col-span-3">
            <FolderExplorer
              folders={state.folders}
              currentFolder={state.currentFolder}
              onFolderSelect={handleFolderSelect}
              loading={state.loading}
            />
          </div>

          {/* Área principal - Grid de arquivos */}
          <div className="col-span-9">
            <FileGrid
              files={state.files}
              selectedFiles={state.selectedFiles}
              viewMode={state.viewMode}
              loading={state.loading}
              onFileSelect={handleFileSelect}
              onSelectAll={handleSelectAll}
            />
          </div>
        </div>

        {/* Modais */}
        {showUploadModal && (
          <FileUpload
            companyId={company.id}
            currentFolderId={state.currentFolder?.id}
            onClose={() => setShowUploadModal(false)}
            onComplete={handleUploadComplete}
          />
        )}

        {showFolderModal && (
          <FolderManager
            companyId={company.id}
            parentFolderId={state.currentFolder?.id}
            onClose={() => setShowFolderModal(false)}
            onComplete={handleFolderCreated}
          />
        )}

        {showActionsModal && state.selectedFiles.length > 0 && (
          <MediaActions
            companyId={company.id}
            selectedFileIds={state.selectedFiles}
            folders={state.folders}
            onClose={() => setShowActionsModal(false)}
            onComplete={handleActionsComplete}
          />
        )}
      </div>
    )
}
