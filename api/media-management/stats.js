// =====================================================
// MEDIA MANAGEMENT - ESTATÍSTICAS
// =====================================================
// API para estatísticas da biblioteca

import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(req, res) {
  // Apenas GET permitido
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas GET é permitido neste endpoint'
    })
  }

  try {
    const { company_id } = req.query

    // Validação
    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    console.log('📊 Buscando estatísticas para empresa:', company_id)

    // Buscar estatísticas de arquivos
    const { data: filesData, error: filesError } = await supabase
      .from('lead_media_unified')
      .select('file_type, file_size')
      .eq('company_id', company_id)

    if (filesError) {
      console.error('❌ Erro ao buscar arquivos:', filesError)
    }

    // Buscar quantidade de pastas
    const { count: folderCount, error: foldersError } = await supabase
      .from('company_folders')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', company_id)

    if (foldersError) {
      console.error('❌ Erro ao buscar pastas:', foldersError)
    }

    // Calcular estatísticas
    const files = filesData || []
    const totalFiles = files.length
    const totalSize = files.reduce((sum, file) => sum + (file.file_size || 0), 0)
    
    const filesByType = files.reduce((acc, file) => {
      acc[file.file_type] = (acc[file.file_type] || 0) + 1
      return acc
    }, {})

    const stats = {
      totalFiles,
      totalSize,
      filesByType,
      folderCount: folderCount || 0
    }

    console.log('✅ Estatísticas obtidas:', stats)

    return res.status(200).json({
      success: true,
      data: stats
    })

  } catch (error) {
    console.error('❌ Erro na API de estatísticas:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao buscar estatísticas',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
