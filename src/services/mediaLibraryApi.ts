// =====================================================
// MEDIA LIBRARY API SERVICE
// =====================================================
// Serviço para integração com APIs da biblioteca de mídia
// Implementação cautelosa com fallbacks

// =====================================================
// INTERFACES
// =====================================================

export interface MediaFile {
  id: string
  original_filename: string
  file_type: 'image' | 'video' | 'audio' | 'document'
  mime_type: string
  file_size: number
  thumbnail_s3_key?: string
  preview_url?: string
  received_at: string
  s3_key: string
  source_message_id?: string
  created_at: string
}

export interface MediaSummary {
  images: number
  videos: number
  audios: number
  documents: number
  total: number
}

export interface CompanyFolder {
  id: string
  company_id: string
  name: string
  path: string
  parent_path?: string
  icon: string
  description?: string
  file_count?: number
  created_at: string
}

export interface PaginationInfo {
  page: number
  limit: number
  totalCount: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface MediaFilesResponse {
  files: MediaFile[]
  pagination: PaginationInfo
  filters: {
    leadId: string
    file_type: string
    search: string
  }
  lastUpdated: string
}

// =====================================================
// CLASSE PRINCIPAL
// =====================================================

class MediaLibraryApiService {
  private baseUrl: string

  constructor() {
    this.baseUrl = '/api/media-library'
  }

  // =====================================================
  // MÉTODOS PARA MÍDIAS POR LEAD
  // =====================================================

  /**
   * Obter resumo de mídias por lead
   */
  async getLeadMediaSummary(
    leadId: string | undefined, 
    companyId: string
  ): Promise<MediaSummary> {
    try {
      console.log('📊 Buscando resumo de mídia para lead:', { leadId, companyId })

      // Se não há leadId, retornar contadores zerados
      if (!leadId) {
        console.log('📊 Sem leadId - retornando contadores zerados')
        return {
          images: 0,
          videos: 0,
          audios: 0,
          documents: 0,
          total: 0
        }
      }

      const response = await fetch(
        `${this.baseUrl}/leads/${leadId}/summary?company_id=${companyId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )

      if (!response.ok) {
        console.log(`⚠️ API retornou ${response.status} - usando contadores zerados`)
        return {
          images: 0,
          videos: 0,
          audios: 0,
          documents: 0,
          total: 0
        }
      }

      const data = await response.json()
      console.log('✅ Resumo de mídia recebido:', data)
      
      return data

    } catch (error) {
      console.error('❌ Erro ao buscar resumo de mídia:', error)
      
      // Retornar contadores zerados em vez de dados mock
      return {
        images: 0,
        videos: 0,
        audios: 0,
        documents: 0,
        total: 0
      }
    }
  }

  /**
   * Listar arquivos de mídia por lead
   */
  async getLeadMediaFiles(
    leadId: string | undefined,
    companyId: string,
    options: {
      fileType?: 'image' | 'video' | 'audio' | 'document'
      page?: number
      limit?: number
      search?: string
    } = {}
  ): Promise<MediaFilesResponse> {
    try {
      const {
        fileType,
        page = 1,
        limit = 20,
        search = ''
      } = options

      console.log('📱 Buscando arquivos para lead:', { leadId, companyId, options })

      // Se não há leadId, retornar lista vazia
      if (!leadId) {
        console.log('📱 Sem leadId - retornando lista vazia')
        return {
          files: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            totalPages: 0
          }
        }
      }

      // Construir query parameters
      const params = new URLSearchParams({
        company_id: companyId,
        page: page.toString(),
        limit: limit.toString()
      })

      if (fileType) {
        params.append('file_type', fileType)
      }

      if (search.trim()) {
        params.append('search', search.trim())
      }

      const response = await fetch(
        `${this.baseUrl}/leads/${leadId}/files?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Erro ao buscar arquivos')
      }

      console.log('✅ Arquivos obtidos:', {
        count: data.data.files.length,
        totalCount: data.data.pagination.totalCount
      })

      return data.data

    } catch (error) {
      console.error('❌ Erro ao buscar arquivos:', error)
      
      // Retornar lista vazia em vez de dados mock
      return {
        files: [],
        pagination: {
          page: 1,
          limit: 20,
          totalCount: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false
        },
        filters: {
          leadId: leadId || '',
          file_type: options.fileType || 'all',
          search: options.search || ''
        },
        lastUpdated: new Date().toISOString()
      }
    }
  }

  // =====================================================
  // MÉTODOS PARA BIBLIOTECA DA EMPRESA
  // =====================================================

  /**
   * Listar pastas da empresa
   */
  async getCompanyFolders(companyId: string): Promise<CompanyFolder[]> {
    try {
      console.log('📁 Buscando pastas da empresa:', companyId)

      const response = await fetch(
        `${this.baseUrl}/company/folders?company_id=${companyId}`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Erro ao buscar pastas')
      }

      console.log('✅ Pastas obtidas:', data.data.folders.length)
      return data.data.folders

    } catch (error) {
      console.error('❌ Erro ao buscar pastas:', error)
      
      // Retornar lista vazia em vez de dados mock
      return []
    }
  }

  /**
   * Criar nova pasta
   */
  async createFolder(
    companyId: string,
    folderData: {
      name: string
      parent_path?: string
      icon?: string
      description?: string
    }
  ): Promise<CompanyFolder> {
    try {
      console.log('📁 Criando nova pasta:', folderData)

      const response = await fetch(
        `${this.baseUrl}/company/folders?company_id=${companyId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(folderData)
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Erro ao criar pasta')
      }

      console.log('✅ Pasta criada:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro ao criar pasta:', error)
      throw error
    }
  }

  // =====================================================
  // MÉTODOS UTILITÁRIOS
  // =====================================================

  /**
   * Formatar tamanho de arquivo
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  /**
   * Obter ícone por tipo de arquivo
   */
  getFileIcon(fileType: string, mimeType: string): string {
    switch (fileType) {
      case 'image': return '🖼️'
      case 'video': return '🎥'
      case 'audio': return '🎵'
      case 'document':
        if (mimeType.includes('pdf')) return '📄'
        if (mimeType.includes('word')) return '📝'
        if (mimeType.includes('excel')) return '📊'
        return '📋'
      default: return '📎'
    }
  }

  /**
   * Formatar data relativa
   */
  formatRelativeDate(dateString: string): string {
    const date = new Date(dateString)
    const now = new Date()
    const diffInMs = now.getTime() - date.getTime()
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))

    if (diffInDays === 0) return 'Hoje'
    if (diffInDays === 1) return 'Ontem'
    if (diffInDays < 7) return `${diffInDays} dias atrás`
    if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} semanas atrás`
    if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} meses atrás`
    return `${Math.floor(diffInDays / 365)} anos atrás`
  }
}

// =====================================================
// EXPORTAR INSTÂNCIA SINGLETON
// =====================================================

export const mediaLibraryApi = new MediaLibraryApiService()
export default mediaLibraryApi
