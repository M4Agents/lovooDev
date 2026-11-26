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
