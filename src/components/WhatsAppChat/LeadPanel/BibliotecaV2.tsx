// =====================================================
// BIBLIOTECA V2 - COMPONENTE PRINCIPAL
// =====================================================
// Data: 2026-02-21 09:26 - ABORDAGEM DO CHAT
// Busca DIRETA do Supabase (sem APIs intermediárias)
// Mesma abordagem que funciona perfeitamente no chat

import React, { useState, useEffect } from 'react'
import { Folder, File, Image, Video, Music, FileText, ChevronLeft, Upload, Plus } from 'lucide-react'
import { DirectS3Upload } from '../../MediaLibrary/DirectS3Upload'
import { supabase } from '../../../lib/supabase' // Usar mesmo cliente que o chat usa

// =====================================================
// INTERFACES
// =====================================================

interface BibliotecaV2Props {
  conversationId: string
  companyId: string
  leadId?: string
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
  source?: string
}

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

interface Stats {
  total: number
  images: number
  videos: number
  audios: number
  documents: number
}

// =====================================================
// COMPONENTE PRINCIPAL
// =====================================================

export const BibliotecaV2: React.FC<BibliotecaV2Props> = ({
  conversationId,
  companyId,
  leadId
}) => {
  console.log('🔥🔥🔥 BIBLIOTECA V2 - COMPONENTE CARREGADO - 2026-02-20 22:22 🔥🔥🔥')
  console.log('📊 Props:', { conversationId, companyId, leadId })
  
  // Estados
  const [loading, setLoading] = useState(true)
  const [activeView, setActiveView] = useState<'chat' | 'folders'>('chat')
  const [chatFiles, setChatFiles] = useState<MediaFile[]>([])
  const [allChatFiles, setAllChatFiles] = useState<MediaFile[]>([]) // Todos os arquivos sem filtro
  const [chatStats, setChatStats] = useState<Stats>({ total: 0, images: 0, videos: 0, audios: 0, documents: 0 })
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'image' | 'video' | 'document'>('all') // Filtro ativo
  const [folders, setFolders] = useState<Folder[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [currentFolderName, setCurrentFolderName] = useState<string>('') // Nome da pasta atual
  const [folderViewMode, setFolderViewMode] = useState<'list' | 'files'>('list') // Navegação hierárquica
  const [folderFiles, setFolderFiles] = useState<MediaFile[]>([])
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFolderIcon, setNewFolderIcon] = useState('📁')
  const [newFolderDescription, setNewFolderDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [previewFile, setPreviewFile] = useState<MediaFile | null>(null)
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<MediaFile | null>(null)
  
  // =====================================================
  // BUSCAR DADOS
  // =====================================================
  
  useEffect(() => {
    if (companyId) {
      fetchData()
    }
  }, [companyId])
  
  const fetchData = async () => {
    try {
      setLoading(true)
      console.log('📊 Carregando dados da Biblioteca V2...')
      
      // Buscar arquivos do chat
      await fetchChatFiles()
      
      // Buscar pastas
      await fetchFolders()
      
    } catch (error) {
      console.error('❌ Erro ao carregar dados:', error)
    } finally {
      setLoading(false)
    }
  }
  
  const fetchChatFiles = async () => {
    try {
      console.log('🔥 BIBLIOTECA V2 - BUSCA DIRETA SUPABASE - 2026-02-21 09:59')
      console.log('📱 Buscando arquivos do chat do lead/conversa selecionada...')
      console.log('🎯 Conversation ID:', conversationId)
      
      // Buscar DIRETO do Supabase filtrando por conversa específica
      // Apenas imagens, vídeos e documentos (sem áudios)
      const { data: messages, error } = await supabase
        .from('chat_messages')
        .select('id, media_url, message_type, content, created_at, company_id, conversation_id')
        .eq('company_id', companyId)
        .eq('conversation_id', conversationId) // ✅ Filtrar por conversa específica
        .in('message_type', ['image', 'video', 'document']) // ✅ Sem áudios
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1000)
      
      if (error) {
        console.error('❌ Erro ao buscar chat_messages:', error)
        return
      }
      
      console.log('✅ Mensagens WhatsApp encontradas:', messages?.length || 0)
      
      // Converter para formato esperado
      const files = (messages || []).map(msg => {
        const s3Key = msg.media_url?.replace('https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/', '') || ''
        const filename = s3Key.split('/').pop() || msg.content || 'arquivo'
        
        return {
          id: msg.id,
          s3_key: s3Key,
          original_filename: filename,
          file_type: msg.message_type,
          mime_type: `${msg.message_type}/unknown`,
          file_size: 0,
          preview_url: msg.media_url,
          received_at: msg.created_at,
          created_at: msg.created_at,
          company_id: msg.company_id,
          source: 'whatsapp_chat'
        }
      })
      
      // Calcular estatísticas
      const stats = files.reduce((acc: any, file) => {
        acc[file.file_type] = (acc[file.file_type] || 0) + 1
        acc.total = (acc.total || 0) + 1
        return acc
      }, {})
      
      console.log('✅ Arquivos processados:', files.length)
      console.log('📊 Estatísticas:', stats)
      
      setAllChatFiles(files) // Guardar todos os arquivos
      setChatFiles(files) // Inicialmente mostrar todos
      setChatStats({
        total: stats.total || 0,
        images: stats.image || 0,
        videos: stats.video || 0,
        documents: stats.document || 0
      })
      setSelectedFilter('all') // Reset filtro
    } catch (error) {
      console.error('❌ Erro ao buscar arquivos do chat:', error)
    }
  }
  
  const fetchFolders = async () => {
    try {
      console.log('📁 Buscando pastas via API...')
      
      // Usar API (mesma que o menu principal usa - já funciona)
      const response = await fetch(`/api/media-library/company/folders?company_id=${companyId}`)
      
      if (!response.ok) {
        console.error('❌ Erro na API:', response.status)
        return
      }
      
      const data = await response.json()
      const foldersList = data.data?.folders || []
      
      console.log('✅ Pastas encontradas:', foldersList.length)
      console.log('📂 Pastas:', foldersList)
      setFolders(foldersList)
    } catch (error) {
      console.error('❌ Erro ao buscar pastas:', error)
    }
  }
  
  const fetchFolderFiles = async (folderId: string) => {
    try {
      console.log('📁 Buscando arquivos da pasta:', folderId)
      
      const response = await fetch(
        `/api/media-management/files/list?company_id=${companyId}&folder_id=${folderId}`
      )
      
      if (!response.ok) {
        console.error('❌ Erro na API:', response.status)
        setFolderFiles([])
        return
      }
      
      const data = await response.json()
      const files = data.data?.files || []
      
      console.log('📊 API retornou:', files.length, 'arquivos')
      console.log('📁 Pasta solicitada:', folderId)
      
      // Debug: mostrar folder_id dos arquivos retornados
      if (files.length > 0) {
        console.log('📋 Primeiros arquivos:', files.slice(0, 3).map((f: any) => ({
          filename: f.original_filename,
          folder_id: f.folder_id,
          folder_id_type: typeof f.folder_id,
          match: String(f.folder_id) === String(folderId)
        })))
      }
      
      // ✅ FILTRO CORRIGIDO: Converter ambos para string para comparação robusta
      // Trata null, undefined, e garante comparação correta
      const filteredFiles = files.filter((file: any) => {
        const fileFolderId = String(file.folder_id || '')
        const targetFolderId = String(folderId || '')
        return fileFolderId === targetFolderId
      })
      
      console.log('✅ Após filtro frontend:', filteredFiles.length, 'arquivos')
      console.log('✅ Arquivos encontrados para pasta', folderId, ':', filteredFiles.length)
      
      setFolderFiles(filteredFiles)
    } catch (error) {
      console.error('❌ Erro ao buscar arquivos:', error)
      setFolderFiles([])
    }
  }
  
  // Buscar arquivos quando pasta for selecionada
  useEffect(() => {
    console.log('🔄 currentFolderId mudou:', currentFolderId)
    if (currentFolderId) {
      fetchFolderFiles(currentFolderId)
    } else {
      console.log('🧹 Limpando folderFiles (nenhuma pasta selecionada)')
      setFolderFiles([])
    }
  }, [currentFolderId])
  
  // =====================================================
  // FILTROS
  // =====================================================
  
  const handleFilterChange = (filter: 'all' | 'image' | 'video' | 'document') => {
    setSelectedFilter(filter)
    
    if (filter === 'all') {
      setChatFiles(allChatFiles)
    } else {
      const filtered = allChatFiles.filter(file => file.file_type === filter)
      setChatFiles(filtered)
    }
  }
  
  const handleFileClick = (file: MediaFile) => {
    console.log('🎬 Click no arquivo:', file.original_filename)
    console.log('📄 Tipo:', file.file_type)
    console.log('🔗 URL:', file.preview_url)
    setPreviewFile(file)
    setShowPreviewModal(true)
    console.log('✅ Modal deve abrir agora')
  }
  
  const closePreviewModal = () => {
    setShowPreviewModal(false)
    setPreviewFile(null)
  }
  
  const handleDeleteClick = (file: MediaFile) => {
    console.log('🗑️ Solicitação de exclusão:', file.original_filename)
    setFileToDelete(file)
    setShowDeleteConfirmModal(true)
  }
  
  const handleConfirmDelete = async () => {
    if (!fileToDelete) return
    
    try {
      console.log('🗑️ Excluindo mídia:', fileToDelete.original_filename)
      
      // Deletar do Supabase
      const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('id', fileToDelete.id)
        .eq('company_id', companyId)
      
      if (error) {
        console.error('❌ Erro ao excluir:', error)
        alert('Erro ao excluir mídia. Tente novamente.')
        return
      }
      
      console.log('✅ Mídia excluída com sucesso')
      
      // Atualizar lista local
      setChatFiles(prev => prev.filter(f => f.id !== fileToDelete.id))
      setAllChatFiles(prev => prev.filter(f => f.id !== fileToDelete.id))
      
      // Atualizar estatísticas
      const newStats = { ...chatStats }
      newStats.total -= 1
      if (fileToDelete.file_type === 'image') newStats.images -= 1
      if (fileToDelete.file_type === 'video') newStats.videos -= 1
      if (fileToDelete.file_type === 'document') newStats.documents -= 1
      setChatStats(newStats)
      
      // Fechar modais
      setShowDeleteConfirmModal(false)
      setShowPreviewModal(false)
      setFileToDelete(null)
      
      alert('✅ Mídia excluída com sucesso')
      
    } catch (error) {
      console.error('❌ Erro ao excluir mídia:', error)
      alert('Erro ao excluir mídia. Tente novamente.')
    }
  }
  
  const handleCancelDelete = () => {
    setShowDeleteConfirmModal(false)
    setFileToDelete(null)
  }
  
  const handleDownload = async (file: MediaFile) => {
    try {
      console.log('📥 Iniciando download:', file.original_filename)
      console.log('🔗 URL:', file.preview_url)
      console.log('📦 Tipo:', file.file_type)
      
      // Para imagens, usar API proxy (bypass CORS)
      if (file.file_type === 'image') {
        console.log('🖼️ Imagem detectada - usando API proxy...')
        
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(file.preview_url)}`
        console.log('📡 Chamando proxy:', proxyUrl.substring(0, 50) + '...')
        
        const response = await fetch(proxyUrl)
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        
        const blob = await response.blob()
        console.log('✅ Imagem baixada via proxy, tamanho:', blob.size)
        
        // Criar URL e download
        const blobUrl = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = file.original_filename
        document.body.appendChild(a)
        a.click()
        
        // Limpar
        setTimeout(() => {
          document.body.removeChild(a)
          window.URL.revokeObjectURL(blobUrl)
          console.log('✅ Download de imagem concluído')
        }, 100)
        
        return
      }
      
      // Para vídeos e documentos, usar fetch direto (funciona)
      console.log('⏳ Baixando arquivo via fetch...')
      const response = await fetch(file.preview_url)
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      
      // Converter para blob
      const blob = await response.blob()
      console.log('✅ Arquivo baixado, tamanho:', blob.size)
      
      // Criar URL temporária do blob
      const blobUrl = window.URL.createObjectURL(blob)
      
      // Criar link e forçar download
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = file.original_filename
      document.body.appendChild(a)
      a.click()
      
      // Limpar
      setTimeout(() => {
        document.body.removeChild(a)
        window.URL.revokeObjectURL(blobUrl)
        console.log('✅ Download concluído')
      }, 100)
      
    } catch (error) {
      console.error('❌ Erro ao baixar arquivo:', error)
      alert('Erro ao baixar arquivo. Tente novamente.')
    }
  }
  
  // =====================================================
  // HANDLERS
  // =====================================================
  
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      alert('Digite um nome para a pasta')
      return
    }
    
    try {
      console.log('📁 Criando pasta:', newFolderName)
      
      const response = await fetch(`/api/media-library/company/folders?company_id=${companyId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newFolderName.trim(),
          parent_id: null,
          icon: newFolderIcon,
          description: newFolderDescription.trim()
        })
      })
      
      const data = await response.json()
      
      if (data.success) {
        console.log('✅ Pasta criada:', data.data.id)
        setShowNewFolderModal(false)
        setNewFolderName('')
        setNewFolderIcon('📁')
        setNewFolderDescription('')
        await fetchFolders()
      } else {
        alert(`Erro ao criar pasta: ${data.error}`)
      }
    } catch (error) {
      console.error('❌ Erro ao criar pasta:', error)
      alert('Erro ao criar pasta')
    }
  }
  
  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return
    
    if (!currentFolderId) {
      alert('Selecione uma pasta primeiro')
      return
    }
    
    try {
      setUploading(true)
      console.log('📤 Iniciando upload...')
      
      const file = files[0]
      const formData = new FormData()
      formData.append('file', file)
      formData.append('company_id', companyId)
      formData.append('folder_id', currentFolderId)
      formData.append('organize_to_folder', 'true')
      
      const response = await fetch('/api/media-management/files/upload', {
        method: 'POST',
        body: formData
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const data = await response.json()
      const uploadResult = data.data
      
      console.log('✅ Upload concluído:', uploadResult.id)
      console.log('📁 Arquivo salvo em:', uploadResult.s3_key)
      console.log('📂 Pasta:', uploadResult.folder_name)
      alert('Arquivo enviado com sucesso!')
      // Recarregar arquivos da pasta
      await fetchData()
    } catch (error) {
      console.error('❌ Erro no upload:', error)
      alert('Erro ao fazer upload')
    } finally {
      setUploading(false)
    }
  }
  
  // =====================================================
  // RENDER
  // =====================================================
  
  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-4xl mb-2">⏳</div>
          <p className="text-gray-600">Carregando biblioteca...</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-purple-50">
        <h2 className="text-xl font-bold text-gray-800 mb-2">📚 Biblioteca de Mídia</h2>
        <p className="text-sm text-gray-600">Gerencie arquivos e pastas da empresa</p>
      </div>
      
      {/* Tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveView('chat')}
          className={`flex-1 px-4 py-3 font-medium transition-colors ${
            activeView === 'chat'
              ? 'border-b-2 border-blue-500 text-blue-600 bg-blue-50'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-center space-x-2">
            <span>💬</span>
            <span>Chat</span>
            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
              {chatStats.total}
            </span>
          </div>
        </button>
        
        <button
          onClick={() => setActiveView('folders')}
          className={`flex-1 px-4 py-3 font-medium transition-colors ${
            activeView === 'folders'
              ? 'border-b-2 border-purple-500 text-purple-600 bg-purple-50'
              : 'text-gray-600 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-center space-x-2">
            <span>📁</span>
            <span>Pastas</span>
            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
              {folders.length}
            </span>
          </div>
        </button>
      </div>
      
      {/* Conteúdo */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeView === 'chat' ? (
          // VIEW: CHAT
          <div>
            {/* Filtros elegantes como botões */}
            <div className="mb-4">
              <h3 className="font-semibold text-gray-800 mb-3 text-sm">Filtrar por tipo:</h3>
              <div className="grid grid-cols-2 gap-2">
                {/* Botão Todos */}
                <button
                  onClick={() => handleFilterChange('all')}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedFilter === 'all'
                      ? 'border-purple-500 bg-purple-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-purple-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📊</span>
                      <span className={`text-sm font-medium ${selectedFilter === 'all' ? 'text-purple-700' : 'text-gray-700'}`}>
                        Todos
                      </span>
                    </div>
                    <span className={`text-sm font-bold ${selectedFilter === 'all' ? 'text-purple-600' : 'text-gray-600'}`}>
                      {chatStats.total}
                    </span>
                  </div>
                </button>

                {/* Botão Imagens */}
                <button
                  onClick={() => handleFilterChange('image')}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedFilter === 'image'
                      ? 'border-blue-500 bg-blue-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🖼️</span>
                      <span className={`text-sm font-medium ${selectedFilter === 'image' ? 'text-blue-700' : 'text-gray-700'}`}>
                        Imagens
                      </span>
                    </div>
                    <span className={`text-sm font-bold ${selectedFilter === 'image' ? 'text-blue-600' : 'text-gray-600'}`}>
                      {chatStats.images}
                    </span>
                  </div>
                </button>

                {/* Botão Vídeos */}
                <button
                  onClick={() => handleFilterChange('video')}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedFilter === 'video'
                      ? 'border-red-500 bg-red-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-red-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">🎥</span>
                      <span className={`text-sm font-medium ${selectedFilter === 'video' ? 'text-red-700' : 'text-gray-700'}`}>
                        Vídeos
                      </span>
                    </div>
                    <span className={`text-sm font-bold ${selectedFilter === 'video' ? 'text-red-600' : 'text-gray-600'}`}>
                      {chatStats.videos}
                    </span>
                  </div>
                </button>

                {/* Botão Documentos */}
                <button
                  onClick={() => handleFilterChange('document')}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    selectedFilter === 'document'
                      ? 'border-green-500 bg-green-50 shadow-md'
                      : 'border-gray-200 bg-white hover:border-green-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">📄</span>
                      <span className={`text-sm font-medium ${selectedFilter === 'document' ? 'text-green-700' : 'text-gray-700'}`}>
                        Documentos
                      </span>
                    </div>
                    <span className={`text-sm font-bold ${selectedFilter === 'document' ? 'text-green-600' : 'text-gray-600'}`}>
                      {chatStats.documents}
                    </span>
                  </div>
                </button>
              </div>
            </div>
            
            {chatFiles.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-4xl mb-2">📭</p>
                <p>Nenhum arquivo recebido no chat ainda</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {chatFiles.map(file => (
                  <div 
                    key={file.id} 
                    draggable={true}
                    onDragStart={(e) => {
                      console.log('🎯 Drag iniciado:', file.original_filename)
                      e.dataTransfer.setData('mediaFile', JSON.stringify({
                        preview_url: file.preview_url,
                        file_type: file.file_type,
                        original_filename: file.original_filename,
                        mime_type: file.mime_type,
                        id: file.id
                      }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onDragEnd={(e) => {
                      console.log('✅ Drag finalizado')
                    }}
                    onClick={() => handleFileClick(file)}
                    className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow cursor-move active:opacity-50"
                  >
                    {/* Preview da mídia */}
                    <div className="aspect-square bg-gray-100 flex items-center justify-center relative overflow-hidden">
                      {file.file_type === 'image' && file.preview_url && (
                        <img 
                          src={file.preview_url} 
                          alt={file.original_filename}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      )}
                      {file.file_type === 'video' && file.preview_url && (
                        <div className="relative w-full h-full bg-black">
                          <video 
                            src={file.preview_url}
                            className="w-full h-full object-cover"
                            preload="metadata"
                          />
                          {/* Overlay com ícone play */}
                          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 pointer-events-none">
                            <div className="w-12 h-12 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
                              <svg className="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            </div>
                          </div>
                        </div>
                      )}
                      {file.file_type === 'document' && (
                        <div className="text-4xl">📄</div>
                      )}
                    </div>
                    {/* Info do arquivo */}
                    <div className="p-2">
                      <p className="text-xs font-medium text-gray-800 truncate" title={file.original_filename}>
                        {file.original_filename}
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(file.created_at).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          // VIEW: PASTAS
          <div>
            {/* Botão Voltar para Pastas (quando pasta selecionada) */}
            {folderViewMode === 'files' && (
              <div className="mb-4">
                <button
                  onClick={() => {
                    setFolderViewMode('list')
                    setCurrentFolderId(null)
                    setCurrentFolderName('')
                    setFolderFiles([])
                  }}
                  className="flex items-center space-x-2 px-4 py-2 text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                >
                  <span>←</span>
                  <span>Voltar para Pastas</span>
                </button>
                <div className="mt-3 flex items-center space-x-2">
                  <span className="text-2xl">📂</span>
                  <h3 className="font-semibold text-gray-800">{currentFolderName}</h3>
                  <span className="text-sm text-gray-500">({folderFiles.length} arquivos)</span>
                </div>
              </div>
            )}

            {/* Lista de Pastas (quando no modo 'list') */}
            {folderViewMode === 'list' && (
              <div className="mb-4 flex justify-between items-center">
                <h3 className="font-semibold text-gray-800">Suas Pastas</h3>
                <button
                  onClick={() => setShowNewFolderModal(true)}
                  className="px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors text-sm font-medium"
                >
                  + Nova Pasta
                </button>
              </div>
            )}
            
            {/* Lista de Pastas - só mostra quando folderViewMode === 'list' */}
            {folderViewMode === 'list' && (
              folders.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-2">📁</p>
                  <p>Nenhuma pasta criada ainda</p>
                  <button
                    onClick={() => setShowNewFolderModal(true)}
                    className="mt-4 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
                  >
                    Criar Primeira Pasta
                  </button>
                </div>
              ) : (
                <>
                <div className="space-y-2">
                  {folders.map(folder => (
                    <div
                      key={folder.id}
                      onClick={() => {
                        setCurrentFolderId(folder.id)
                        setCurrentFolderName(folder.name)
                        setFolderViewMode('files')
                      }}
                      className="p-4 border border-gray-200 rounded-lg cursor-pointer transition-all hover:border-purple-300 hover:bg-gray-50"
                    >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl">{folder.icon}</span>
                        <div>
                          <p className="font-medium text-gray-800">{folder.name}</p>
                          {folder.description && (
                            <p className="text-xs text-gray-500">{folder.description}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-sm text-gray-500">
                        {folder.file_count || 0} arquivos
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {!currentFolderId && (
                <div className="text-center py-8 px-4 bg-purple-50 rounded-lg border border-purple-200 mt-4">
                  <p className="text-2xl mb-2">👆</p>
                  <p className="text-purple-700 font-medium">Selecione uma pasta acima</p>
                  <p className="text-sm text-purple-600 mt-1">para fazer upload de arquivos</p>
                </div>
              )}
              </>
              )
            )}
            
            {currentFolderId && (
              <>
                {/* Lista de arquivos da pasta */}
                {currentFolderId && folderFiles.length > 0 && (
                  <div className="mt-4">
                    <h3 className="font-medium text-gray-800 mb-2">📄 Arquivos ({folderFiles.length})</h3>
                    <div className="grid grid-cols-2 gap-2">
                      {folderFiles.map(file => (
                        <div
                          key={file.id}
                          draggable={true}
                          onDragStart={(e) => {
                            console.log('🎯 Drag iniciado (Pasta):', file.original_filename)
                            e.dataTransfer.setData('mediaFile', JSON.stringify({
                              preview_url: file.preview_url,
                              file_type: file.file_type,
                              original_filename: file.original_filename,
                              mime_type: file.mime_type,
                              id: file.id
                            }))
                            e.dataTransfer.effectAllowed = 'copy'
                          }}
                          onDragEnd={(e) => {
                            console.log('✅ Drag finalizado (Pasta)')
                          }}
                          onClick={() => {
                            setPreviewFile(file)
                            setShowPreviewModal(true)
                          }}
                          className="border rounded-lg p-2 cursor-move hover:border-purple-300 hover:bg-purple-50 transition-all active:opacity-50"
                        >
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
                          <p className="text-xs truncate text-gray-700">{file.original_filename}</p>
                          <p className="text-xs text-gray-500">
                            {(file.file_size / 1024).toFixed(0)} KB
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Upload de arquivo */}
                <div className="mt-4">
                  <DirectS3Upload
                    companyId={companyId}
                    folderId={currentFolderId}
                    onUploadComplete={(fileId) => {
                      console.log('✅ Upload S3 completo! File ID:', fileId)
                      console.log('🔄 Recarregando lista de arquivos...')
                      // Recarregar lista de arquivos da pasta atual
                      if (currentFolderId) {
                        fetchFolderFiles(currentFolderId)
                      }
                    }}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
      
      {/* Modal Nova Pasta */}
      {showNewFolderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 max-w-full mx-4">
            <h3 className="text-lg font-bold mb-4">📁 Nova Pasta</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nome da Pasta *
                </label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="Ex: Marketing, Produtos..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Ícone
                </label>
                <div className="flex space-x-2">
                  {['📁', '📂', '📢', '📦', '📄', '📋', '🎨', '🎬', '📷', '💰'].map(icon => (
                    <button
                      key={icon}
                      onClick={() => setNewFolderIcon(icon)}
                      className={`text-2xl p-2 rounded-lg transition-colors ${
                        newFolderIcon === icon
                          ? 'bg-purple-100 ring-2 ring-purple-500'
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Descrição (opcional)
                </label>
                <input
                  type="text"
                  value={newFolderDescription}
                  onChange={(e) => setNewFolderDescription(e.target.value)}
                  placeholder="Descrição da pasta..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowNewFolderModal(false)
                  setNewFolderName('')
                  setNewFolderIcon('📁')
                  setNewFolderDescription('')
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="flex-1 px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Criar Pasta
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal de Preview de Mídia */}
      {showPreviewModal && previewFile && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
          onClick={closePreviewModal}
        >
          <div className="relative max-w-4xl w-full max-h-full flex flex-col">
            {/* Botões superiores */}
            <div className="absolute top-4 right-4 z-10 flex gap-2">
              {/* Botão Download */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDownload(previewFile)
                }}
                className="w-10 h-10 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center text-white shadow-lg transition-colors"
                title="Baixar arquivo"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              
              {/* Botão Excluir */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteClick(previewFile)
                }}
                className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-white shadow-lg transition-colors"
                title="Excluir mídia"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              
              {/* Botão Fechar */}
              <button
                onClick={closePreviewModal}
                className="w-10 h-10 rounded-full bg-gray-200 hover:bg-gray-300 flex items-center justify-center text-gray-800 text-2xl transition-colors shadow-lg"
                title="Fechar"
              >
                ×
              </button>
            </div>
            
            {/* Conteúdo do preview */}
            <div className="flex-1 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              {previewFile.file_type === 'image' && (
                <img 
                  src={previewFile.preview_url} 
                  alt={previewFile.original_filename}
                  className="max-w-full max-h-[80vh] object-contain"
                />
              )}
              
              {previewFile.file_type === 'video' && (
                <video 
                  src={previewFile.preview_url}
                  controls
                  autoPlay
                  className="max-w-full max-h-[80vh]"
                >
                  Seu navegador não suporta vídeos.
                </video>
              )}
              
              {previewFile.file_type === 'document' && (
                <div className="bg-white rounded-lg p-8 text-center">
                  <div className="text-6xl mb-4">📄</div>
                  <p className="text-lg font-medium text-gray-800 mb-2">{previewFile.original_filename}</p>
                  <button
                    onClick={() => handleDownload(previewFile)}
                    className="inline-block px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors cursor-pointer"
                  >
                    Baixar Documento
                  </button>
                </div>
              )}
            </div>
            
            {/* Info do arquivo */}
            <div className="mt-4 text-center text-white">
              <p className="font-medium">{previewFile.original_filename}</p>
              <p className="text-sm text-gray-300">
                {new Date(previewFile.created_at).toLocaleDateString('pt-BR')}
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal de Confirmação de Exclusão */}
      {showDeleteConfirmModal && fileToDelete && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 z-[60] flex items-center justify-center p-4"
          onClick={handleCancelDelete}
        >
          <div 
            className="bg-white rounded-lg max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900">ATENÇÃO - Exclusão Permanente</h3>
                <p className="text-sm text-gray-600">Esta ação não pode ser desfeita</p>
              </div>
            </div>
            
            {/* Conteúdo */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-gray-800 mb-3">
                Você está prestes a excluir:
              </p>
              <p className="font-medium text-gray-900 mb-4">
                📄 {fileToDelete.original_filename}
              </p>
              
              <div className="space-y-2 text-sm text-gray-700">
                <p className="font-semibold text-red-700">⚠️ A mídia será removida:</p>
                <ul className="space-y-1 ml-4">
                  <li>• ❌ Da Biblioteca</li>
                  <li>• ❌ Do histórico do Chat</li>
                  <li>• ❌ Permanentemente do sistema</li>
                </ul>
              </div>
            </div>
            
            <p className="text-sm text-gray-700 mb-6">
              Tem certeza que deseja continuar?
            </p>
            
            {/* Botões */}
            <div className="flex gap-3">
              <button
                onClick={handleCancelDelete}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Sim, Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BibliotecaV2
