// =====================================================
// MEDIA MANAGEMENT - HIERARQUIA DE PASTAS
// =====================================================
// API para listar pastas com hierarquia

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

    console.log('📁 Buscando hierarquia de pastas para empresa:', company_id)

    // Buscar todas as pastas da empresa
    const { data, error } = await supabase
      .from('company_folders')
      .select('*')
      .eq('company_id', company_id)
      .order('name')

    if (error) {
      console.error('❌ Erro ao buscar pastas:', error)
      return res.status(500).json({
        error: 'Erro ao buscar pastas',
        message: error.message
      })
    }

    // Transformar em formato hierárquico
    const folders = (data || []).map(folder => ({
      id: folder.id,
      company_id: folder.company_id,
      name: folder.name,
      path: folder.path,
      parent_path: folder.parent_path,
      parent_id: null, // Por enquanto, sem hierarquia real
      folder_path: folder.path,
      icon: folder.icon || '📁',
      description: folder.description,
      file_count: folder.file_count || 0,
      total_size: 0,
      created_at: folder.created_at
    }))

    console.log('✅ Hierarquia obtida:', folders.length, 'pastas')

    return res.status(200).json({
      success: true,
      data: {
        folders
      }
    })

  } catch (error) {
    console.error('❌ Erro na API de hierarquia:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao buscar hierarquia de pastas',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
