// =====================================================
// MEDIA MANAGEMENT SERVICE - GESTÃO COMPLETA
// =====================================================
// Serviço estendido para gestão completa de mídias da empresa
// Baseado no mediaLibraryApi.ts existente

import { MediaFile, CompanyFolder } from './mediaLibraryApi'

// =====================================================
// INTERFACES ESTENDIDAS
// =====================================================

export interface MediaFolder extends CompanyFolder {
  parent_id?: string
  folder_path: string
  children?: MediaFolder[]
  file_count: number
  total_size: number
  is_system_folder?: boolean
}

export interface MediaFileExtended extends MediaFile {
  folder_id?: string
  folder_path?: string
  uploaded_by?: string
  tags?: string[]
  is_favorite?: boolean
}

export interface FolderCreateData {
  name: string
  parent_id?: string
  icon?: string
  description?: string
}

export interface BulkActionResult {
  success: boolean
  processed: number
  failed: number
  errors: string[]
}

// =====================================================
// CLASSE PRINCIPAL
// =====================================================

class MediaManagementService {
  private baseUrl: string

  constructor() {
    this.baseUrl = '/api/media-management'
  }

  // =====================================================
  // GESTÃO DE PASTAS
  // =====================================================

  /**
   * Listar pastas com hierarquia
   */
  async getFoldersHierarchy(companyId: string): Promise<MediaFolder[]> {
    try {
      console.log('📁 Buscando hierarquia de pastas:', companyId)

      const response = await fetch(
        `${this.baseUrl}/folders/hierarchy?company_id=${companyId}`,
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
      console.log('✅ Hierarquia obtida:', data.data.folders.length, 'pastas')
      return data.data.folders

    } catch (error) {
      console.error('❌ Erro ao buscar hierarquia:', error)
      return []
    }
  }

  /**
   * Criar nova pasta
   */
  async createFolder(companyId: string, folderData: FolderCreateData): Promise<MediaFolder> {
    try {
      console.log('📁 Criando pasta:', folderData)

      const response = await fetch(
        `${this.baseUrl}/folders/create?company_id=${companyId}`,
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
      console.log('✅ Pasta criada:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro ao criar pasta:', error)
      throw error
    }
  }

  /**
   * Renomear pasta
   */
  async renameFolder(companyId: string, folderId: string, newName: string): Promise<MediaFolder> {
    try {
      console.log('📝 Renomeando pasta:', { folderId, newName })

      const response = await fetch(
        `${this.baseUrl}/folders/rename?company_id=${companyId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ folder_id: folderId, new_name: newName })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Pasta renomeada:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro ao renomear pasta:', error)
      throw error
    }
  }

  /**
   * Excluir pasta
   */
  async deleteFolder(companyId: string, folderId: string, force: boolean = false): Promise<boolean> {
    try {
      console.log('🗑️ Excluindo pasta:', { folderId, force })

      const response = await fetch(
        `${this.baseUrl}/folders/delete?company_id=${companyId}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ folder_id: folderId, force })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Pasta excluída:', data.success)
      return data.success

    } catch (error) {
      console.error('❌ Erro ao excluir pasta:', error)
      throw error
    }
  }

  /**
   * Mover pasta
   */
  async moveFolder(companyId: string, folderId: string, newParentId?: string): Promise<MediaFolder> {
    try {
      console.log('📦 Movendo pasta:', { folderId, newParentId })

      const response = await fetch(
        `${this.baseUrl}/folders/move?company_id=${companyId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ folder_id: folderId, new_parent_id: newParentId })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Pasta movida:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro ao mover pasta:', error)
      throw error
    }
  }

  // =====================================================
  // GESTÃO DE ARQUIVOS
  // =====================================================

  /**
   * Listar arquivos de uma pasta
   */
  async getFolderFiles(
    companyId: string, 
    folderId?: string,
    options: {
      fileType?: string
      page?: number
      limit?: number
      search?: string
      sortBy?: 'name' | 'date' | 'size' | 'type'
      sortOrder?: 'asc' | 'desc'
    } = {}
  ): Promise<{
    files: MediaFileExtended[]
    pagination: any
    folder?: MediaFolder
  }> {
    try {
      const {
        fileType,
        page = 1,
        limit = 50,
        search = '',
        sortBy = 'date',
        sortOrder = 'desc'
      } = options

      console.log('📄 Buscando arquivos da pasta:', { folderId, options })

      const params = new URLSearchParams({
        company_id: companyId,
        page: page.toString(),
        limit: limit.toString(),
        sort_by: sortBy,
        sort_order: sortOrder
      })

      if (folderId) {
        params.append('folder_id', folderId)
      }

      if (fileType) {
        params.append('file_type', fileType)
      }

      if (search.trim()) {
        params.append('search', search.trim())
      }

      // CORREÇÃO PASTA CHAT: Detectar pasta Chat diretamente e usar API específica
      const apiUrl = `${this.baseUrl}/files/list?${params.toString()}`
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      const files = data.data.files || []
      
      // ✅ FILTRO ADICIONAL (proteção contra bug da API)
      // Garantir que apenas arquivos com folder_id correto sejam retornados
      let filteredFiles = files
      if (folderId) {
        filteredFiles = files.filter((file: any) => file.folder_id === folderId)
        console.log('📊 API retornou:', files.length, 'arquivos')
        console.log('✅ Após filtro frontend:', filteredFiles.length, 'arquivos')
      }
      
      console.log('✅ Arquivos obtidos:', filteredFiles.length)
      return {
        ...data.data,
        files: filteredFiles
      }

    } catch (error) {
      console.error('❌ Erro ao buscar arquivos:', error)
      return {
        files: [],
        pagination: {
          page: 1,
          limit: 50,
          totalCount: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false
        }
      }
    }
  }

  /**
   * Renomear arquivo
   */
  async renameFile(companyId: string, fileId: string, newName: string): Promise<MediaFileExtended> {
    try {
      console.log('📝 Renomeando arquivo:', { fileId, newName })

      const response = await fetch(
        `${this.baseUrl}/files/rename?company_id=${companyId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ file_id: fileId, new_name: newName })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Arquivo renomeado:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro ao renomear arquivo:', error)
      throw error
    }
  }

  /**
   * Organizar arquivo para pasta específica
   */
  async organizeFile(companyId: string, fileId: string, folderId: string): Promise<MediaFileExtended> {
    try {
      console.log('📁 Organizando arquivo para pasta:', { fileId, folderId })

      const response = await fetch(
        `${this.baseUrl}/files/organize?company_id=${companyId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ 
            file_id: fileId, 
            folder_id: folderId 
          })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Arquivo organizado:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro ao organizar arquivo:', error)
      throw error
    }
  }

  /**
   * Excluir arquivo
   */
  async deleteFile(companyId: string, fileId: string): Promise<boolean> {
    try {
      console.log('🗑️ Excluindo arquivo:', fileId)

      const response = await fetch(
        `${this.baseUrl}/files/delete?company_id=${companyId}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ file_id: fileId })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Arquivo excluído:', data.success)
      return data.success

    } catch (error) {
      console.error('❌ Erro ao excluir arquivo:', error)
      throw error
    }
  }

  /**
   * Mover arquivo
   */
  async moveFile(companyId: string, fileId: string, newFolderId?: string): Promise<MediaFileExtended> {
    try {
      console.log('📦 Movendo arquivo:', { fileId, newFolderId })

      const response = await fetch(
        `${this.baseUrl}/files/move?company_id=${companyId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ file_id: fileId, new_folder_id: newFolderId })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Arquivo movido:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro ao mover arquivo:', error)
      throw error
    }
  }

  // =====================================================
  // AÇÕES EM LOTE
  // =====================================================

  /**
   * Excluir múltiplos arquivos
   */
  async deleteMultipleFiles(companyId: string, fileIds: string[]): Promise<BulkActionResult> {
    try {
      console.log('🗑️ Excluindo múltiplos arquivos:', fileIds.length)

      const response = await fetch(
        `${this.baseUrl}/files/delete?company_id=${companyId}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ fileIds: fileIds })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Exclusão em lote concluída:', data)
      
      // Transformar resposta da API para formato esperado pelo frontend
      const result: BulkActionResult = {
        success: data.success,
        processed: data.deletedFiles?.length || 0,
        failed: 0,
        errors: []
      }
      
      return result

    } catch (error) {
      console.error('❌ Erro na exclusão em lote:', error)
      throw error
    }
  }

  /**
   * Mover múltiplos arquivos
   */
  async moveMultipleFiles(companyId: string, fileIds: string[], newFolderId?: string): Promise<BulkActionResult> {
    try {
      console.log('📦 Movendo múltiplos arquivos:', fileIds.length)

      const response = await fetch(
        `${this.baseUrl}/files/bulk-move?company_id=${companyId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ file_ids: fileIds, new_folder_id: newFolderId })
        }
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      console.log('✅ Movimentação em lote concluída:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro na movimentação em lote:', error)
      throw error
    }
  }

  // =====================================================
  // BUSCA E FILTROS
  // =====================================================

  /**
   * Busca global de arquivos
   */
  async searchFiles(
    companyId: string,
    query: string,
    options: {
      fileType?: string
      folderId?: string
      dateFrom?: string
      dateTo?: string
      minSize?: number
      maxSize?: number
      page?: number
      limit?: number
    } = {}
  ): Promise<{
    files: MediaFileExtended[]
    pagination: any
    total: number
  }> {
    try {
      const {
        fileType,
        folderId,
        dateFrom,
        dateTo,
        minSize,
        maxSize,
        page = 1,
        limit = 50
      } = options

      console.log('🔍 Buscando arquivos:', { query, options })

      const params = new URLSearchParams({
        company_id: companyId,
        query: query.trim(),
        page: page.toString(),
        limit: limit.toString()
      })

      if (fileType) params.append('file_type', fileType)
      if (folderId) params.append('folder_id', folderId)
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo) params.append('date_to', dateTo)
      if (minSize) params.append('min_size', minSize.toString())
      if (maxSize) params.append('max_size', maxSize.toString())

      const response = await fetch(
        `${this.baseUrl}/files/search?${params.toString()}`,
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
      console.log('✅ Busca concluída:', data.data.files.length, 'resultados')
      return data.data

    } catch (error) {
      console.error('❌ Erro na busca:', error)
      return {
        files: [],
        pagination: {
          page: 1,
          limit: 50,
          totalCount: 0,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false
        },
        total: 0
      }
    }
  }

  // =====================================================
  // UTILITÁRIOS
  // =====================================================

  /**
   * Obter estatísticas da biblioteca
   */
  async getLibraryStats(companyId: string): Promise<{
    totalFiles: number
    totalSize: number
    filesByType: Record<string, number>
    folderCount: number
  }> {
    try {
      console.log('📊 Buscando estatísticas da biblioteca:', companyId)

      const response = await fetch(
        `${this.baseUrl}/stats?company_id=${companyId}`,
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
      console.log('✅ Estatísticas obtidas:', data.data)
      return data.data

    } catch (error) {
      console.error('❌ Erro ao buscar estatísticas:', error)
      return {
        totalFiles: 0,
        totalSize: 0,
        filesByType: {},
        folderCount: 0
      }
    }
  }

  /**
   * Validar nome de pasta/arquivo
   */
  validateName(name: string): { valid: boolean; error?: string } {
    if (!name.trim()) {
      return { valid: false, error: 'Nome não pode estar vazio' }
    }

    if (name.length > 255) {
      return { valid: false, error: 'Nome muito longo (máximo 255 caracteres)' }
    }

    // Caracteres proibidos
    const invalidChars = /[<>:"/\\|?*]/
    if (invalidChars.test(name)) {
      return { valid: false, error: 'Nome contém caracteres inválidos' }
    }

    // Nomes reservados
    const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']
    if (reservedNames.includes(name.toUpperCase())) {
      return { valid: false, error: 'Nome reservado do sistema' }
    }

    return { valid: true }
  }

  /**
   * Gerar breadcrumb de pasta
   */
  generateBreadcrumb(folder: MediaFolder, allFolders: MediaFolder[]): Array<{ id: string; name: string; path: string }> {
    const breadcrumb = []
    let currentFolder = folder

    while (currentFolder) {
      breadcrumb.unshift({
        id: currentFolder.id,
        name: currentFolder.name,
        path: currentFolder.folder_path
      })

      if (currentFolder.parent_id) {
        const parentFolder = allFolders.find(f => f.id === currentFolder.parent_id)
        if (parentFolder) {
          currentFolder = parentFolder
        } else {
          break
        }
      } else {
        break
      }
    }

    return breadcrumb
  }
}

// =====================================================
// EXPORTAR INSTÂNCIA SINGLETON
// =====================================================

export const mediaManagement = new MediaManagementService()
export default mediaManagement
