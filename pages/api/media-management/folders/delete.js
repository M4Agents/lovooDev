// =====================================================
// MEDIA MANAGEMENT - DELETE DE PASTA
// =====================================================
// API para deletar pastas da biblioteca de mídias
// PROTEÇÃO: Pastas do sistema não podem ser deletadas

import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(req, res) {
  // Apenas DELETE permitido
  if (req.method !== 'DELETE') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas DELETE é permitido neste endpoint'
    })
  }

  try {
    const { folderId } = req.body
    const { company_id } = req.query

    console.log('🗑️ Iniciando delete de pasta:', { folderId, company_id })

    // Validações básicas
    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    if (!folderId) {
      return res.status(400).json({
        error: 'Folder ID obrigatório',
        message: 'Parâmetro folderId é necessário'
      })
    }

    // Buscar pasta para verificar se existe e se é do sistema
    const { data: folder, error: fetchError } = await supabase
      .from('company_folders')
      .select('id, name, path, is_system_folder')
      .eq('company_id', company_id)
      .eq('id', folderId)
      .single()

    if (fetchError) {
      console.error('❌ Erro ao buscar pasta:', fetchError)
      return res.status(500).json({
        error: 'Erro ao buscar pasta',
        message: fetchError.message
      })
    }

    if (!folder) {
      return res.status(404).json({
        error: 'Pasta não encontrada',
        message: 'Pasta não encontrada com o ID fornecido'
      })
    }

    // 🚨 PROTEÇÃO: Verificar se é pasta do sistema
    if (folder.is_system_folder) {
      console.log('🚨 PROTEÇÃO ATIVADA: Tentativa de deletar pasta do sistema:', folder.name)
      return res.status(403).json({
        error: 'Pasta protegida',
        message: `A pasta "${folder.name}" é uma pasta do sistema e não pode ser deletada`,
        folder: {
          name: folder.name,
          path: folder.path,
          isSystemFolder: true
        }
      })
    }

    console.log('📁 Pasta encontrada para delete:', folder.name, '(não é do sistema)')

    // Verificar se há arquivos na pasta
    const { data: filesInFolder, error: filesError } = await supabase
      .from('lead_media_unified')
      .select('id')
      .eq('company_id', company_id)
      .eq('folder_id', folderId)
      .limit(1)

    if (filesError) {
      console.error('❌ Erro ao verificar arquivos na pasta:', filesError)
      return res.status(500).json({
        error: 'Erro ao verificar arquivos',
        message: filesError.message
      })
    }

    if (filesInFolder && filesInFolder.length > 0) {
      return res.status(400).json({
        error: 'Pasta não está vazia',
        message: 'Não é possível deletar uma pasta que contém arquivos. Mova ou delete os arquivos primeiro.',
        hasFiles: true
      })
    }

    // Deletar a pasta
    const { error: deleteError } = await supabase
      .from('company_folders')
      .delete()
      .eq('company_id', company_id)
      .eq('id', folderId)

    if (deleteError) {
      console.error('❌ Erro ao deletar pasta:', deleteError)
      return res.status(500).json({
        error: 'Erro ao deletar pasta',
        message: deleteError.message
      })
    }

    console.log('✅ Pasta deletada com sucesso:', folder.name)

    return res.status(200).json({
      success: true,
      message: `Pasta "${folder.name}" deletada com sucesso`,
      deletedFolder: {
        id: folder.id,
        name: folder.name,
        path: folder.path
      }
    })

  } catch (error) {
    console.error('❌ Erro na API de delete de pasta:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao deletar pasta',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
