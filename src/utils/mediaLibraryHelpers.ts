// =====================================================
// HELPERS: BIBLIOTECA DE MÍDIA
// Data: 17/03/2026
// Objetivo: Funções auxiliares para gerenciar biblioteca
// =====================================================

import { supabase } from '../lib/supabase'

/**
 * Garante que a pasta "Audios" existe para a empresa
 * Cria automaticamente se não existir
 * 
 * @param companyId - ID da empresa
 * @returns ID da pasta Audios
 */
export async function ensureAudiosFolderExists(companyId: string): Promise<string> {
  try {
    console.log('📁 Verificando pasta Audios para empresa:', companyId)
    
    // 1. Verificar se pasta já existe
    const { data: existingFolder } = await supabase
      .from('company_folders')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('name', 'Audios')
      .maybeSingle()
    
    if (existingFolder) {
      console.log('✅ Pasta Audios já existe:', existingFolder.id)
      return existingFolder.id
    }
    
    // 2. Criar pasta se não existir
    console.log('📁 Criando pasta Audios para empresa:', companyId)
    const { data: newFolder, error: createError } = await supabase
      .from('company_folders')
      .insert({
        company_id: companyId,
        name: 'Audios',
        description: 'Áudios gravados em automação',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()
    
    if (createError) {
      console.error('❌ Erro ao criar pasta Audios:', createError)
      throw new Error(`Erro ao criar pasta Audios: ${createError.message}`)
    }
    
    console.log('✅ Pasta Audios criada com sucesso:', newFolder.id)
    return newFolder.id
    
  } catch (error) {
    console.error('❌ Erro ao garantir pasta Audios:', error)
    throw error
  }
}

/**
 * Upload de arquivo para biblioteca com pasta específica
 * 
 * @param file - Arquivo a ser enviado
 * @param companyId - ID da empresa
 * @param folderId - ID da pasta de destino
 * @returns Dados do arquivo enviado
 */
export async function uploadToLibrary(
  file: File,
  companyId: string,
  folderId: string
): Promise<{
  success: boolean
  fileId?: string
  mediaUrl?: string
  error?: string
}> {
  try {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('company_id', companyId)
    formData.append('folder_id', folderId)
    
    const response = await fetch('/api/media-library/upload-to-folder', {
      method: 'POST',
      body: formData
    })
    
    const result = await response.json()
    
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Erro no upload')
    }
    
    const uploadedFile = result.data.uploads[0]
    
    return {
      success: true,
      fileId: uploadedFile.file.id,
      mediaUrl: uploadedFile.file.preview_url
    }
    
  } catch (error) {
    console.error('❌ Erro no upload:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Erro desconhecido'
    }
  }
}
