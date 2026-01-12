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
import { mediaLibraryApi } from '../services/mediaLibraryApi'
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
  
  // Estados para editar/excluir pastas
  const [showEditFolderModal, setShowEditFolderModal] = useState(false)
  const [showDeleteFolderModal, setShowDeleteFolderModal] = useState(false)
  const [selectedFolderForEdit, setSelectedFolderForEdit] = useState<MediaFolder | null>(null)
  const [editFolderName, setEditFolderName] = useState('')
  const [editFolderIcon, setEditFolderIcon] = useState('')
  const [editFolderDescription, setEditFolderDescription] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)

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
        console.log('🔍 CHAT FOLDER DETECTED')
      }
      
      if (isChatFolder) {
        console.log('💬 FRONTEND: Detectou pasta Chat, usando nova API S3 direta')
        try {
          // Usar nova API de listagem S3 direta para pasta Chat
          const response = await fetch(`/api/chat-files?page=1&limit=1000`, {
            method: 'GET',
            headers: {
              // 'Authorization': `Bearer ${user?.accessToken}`, // Token não disponível no User type
              'Content-Type': 'application/json'
            }
          })
          
          if (response.ok) {
            filesData = await response.json()
            console.log('✅ FRONTEND: Dados obtidos da nova API S3:', {
              totalFiles: filesData.stats?.total || 0,
              returnedFiles: filesData.files?.length || 0
            })
          } else {
            throw new Error(`Erro na API S3: ${response.status}`)
          }
        } catch (error) {
          console.error('❌ FRONTEND: Erro na nova API S3, usando fallback:', error)
          // Fallback para API antiga se nova falhar
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

      // CORREÇÃO CRÍTICA: Verificar se filesData existe e tem estrutura correta
      let files = filesData?.files || []
      
      // FILTRO ESPECÍFICO PARA PASTA CHAT: Mostrar apenas mídias do WhatsApp
      if (isChatFolder && Array.isArray(files)) {
        const originalCount = files.length
        files = files.filter(file => file.s3_key && file.s3_key.startsWith('clientes/'))
        console.log('🔍 FRONTEND: Filtro pasta Chat aplicado:', {
          originalCount,
          filteredCount: files.length,
          removedCount: originalCount - files.length
        })
      }
      
      console.log('📊 FRONTEND: Dados processados:', {
        filesDataExists: !!filesData,
        filesArray: Array.isArray(files),
        filesCount: files.length,
        isChatFolder
      })

      setState(prev => ({
        ...prev,
        folders,
        files: files,
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
  // HANDLERS PARA EDITAR/EXCLUIR PASTAS
  // =====================================================

  const handleEditFolder = (folder: MediaFolder) => {
    console.log('✏️ Editando pasta:', folder.name)
    setSelectedFolderForEdit(folder)
    setEditFolderName(folder.name)
    setEditFolderIcon(folder.icon || '📁')
    setEditFolderDescription(folder.description || '')
    setShowEditFolderModal(true)
  }

  const handleDeleteFolder = (folder: MediaFolder) => {
    console.log('🗑️ Tentando excluir pasta:', folder.name)
    setSelectedFolderForEdit(folder)
    setDeleteError(null)
    setShowDeleteFolderModal(true)
  }

  const handleSaveEditFolder = async () => {
    if (!selectedFolderForEdit || !editFolderName.trim() || !company?.id) return

    try {
      console.log('💾 Salvando edição da pasta:', editFolderName)
      
      await mediaLibraryApi.editFolder(company.id, selectedFolderForEdit.id, {
        name: editFolderName.trim(),
        icon: editFolderIcon,
        description: editFolderDescription
      })

      // Recarregar dados
      await loadData()
      
      // Fechar modal
      setShowEditFolderModal(false)
      setSelectedFolderForEdit(null)
      
      console.log('✅ Pasta editada com sucesso')
    } catch (error) {
      console.error('❌ Erro ao editar pasta:', error)
      alert('Erro ao editar pasta: ' + (error as Error).message)
    }
  }

  const handleConfirmDeleteFolder = async () => {
    if (!selectedFolderForEdit || !company?.id) return

    try {
      console.log('🗑️ Confirmando exclusão da pasta:', selectedFolderForEdit.name)
      
      const result = await mediaLibraryApi.deleteFolder(company.id, selectedFolderForEdit.id)
      
      if (result.success) {
        // Recarregar dados
        await loadData()
        
        // Fechar modal
        setShowDeleteFolderModal(false)
        setSelectedFolderForEdit(null)
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
              onEditFolder={handleEditFolder}
              onDeleteFolder={handleDeleteFolder}
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
            companyFolders={state.folders.map(folder => ({
              id: folder.id,
              name: folder.name,
              icon: folder.icon || '📁'
            }))}
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

        {/* MODAL DE EDIÇÃO DE PASTA */}
        {showEditFolderModal && selectedFolderForEdit && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">✏️ Editar Pasta</h3>
                <button
                  onClick={() => setShowEditFolderModal(false)}
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
                  onClick={() => setShowEditFolderModal(false)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveEditFolder}
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
        {showDeleteFolderModal && selectedFolderForEdit && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">🗑️ Excluir Pasta</h3>
                <button
                  onClick={() => setShowDeleteFolderModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="mb-4">
                <div className="flex items-center space-x-3 mb-3">
                  <span className="text-2xl">{selectedFolderForEdit.icon}</span>
                  <div>
                    <div className="font-medium text-gray-900">{selectedFolderForEdit.name}</div>
                    <div className="text-sm text-gray-500">{selectedFolderForEdit.description}</div>
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
                  onClick={() => setShowDeleteFolderModal(false)}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancelar
                </button>
                {!deleteError && (
                  <button
                    onClick={handleConfirmDeleteFolder}
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
