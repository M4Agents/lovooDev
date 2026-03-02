// =====================================================
// MEDIA MANAGEMENT - CRIAR PASTA
// =====================================================
// API para criar nova pasta

import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(req, res) {
  // Apenas POST permitido
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas POST é permitido neste endpoint'
    })
  }

  try {
    const { company_id } = req.query
    const { name, parent_id, icon, description } = req.body

    // Validações
    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: 'Nome obrigatório',
        message: 'Nome da pasta é obrigatório'
      })
    }

    console.log('📁 Criando pasta:', { name, parent_id, company_id })

    // Gerar path da pasta
    let folderPath = `/${name.trim()}`
    if (parent_id) {
      // Buscar pasta pai para construir path
      const { data: parentFolder } = await supabase
        .from('company_folders')
        .select('path')
        .eq('id', parent_id)
        .single()
      
      if (parentFolder) {
        folderPath = `${parentFolder.path}/${name.trim()}`
      }
    }

    // Criar pasta
    const { data, error } = await supabase
      .from('company_folders')
      .insert({
        company_id,
        name: name.trim(),
        path: folderPath,
        parent_path: parent_id ? null : null, // Simplificado por enquanto
        icon: icon || '📁',
        description: description?.trim() || null,
        file_count: 0
      })
      .select()
      .single()

    if (error) {
      console.error('❌ Erro ao criar pasta:', error)
      return res.status(500).json({
        error: 'Erro ao criar pasta',
        message: error.message
      })
    }

    console.log('✅ Pasta criada:', data)

    // Retornar no formato esperado
    const folder = {
      id: data.id,
      company_id: data.company_id,
      name: data.name,
      path: data.path,
      parent_path: data.parent_path,
      parent_id: parent_id || null,
      folder_path: data.path,
      icon: data.icon,
      description: data.description,
      file_count: 0,
      total_size: 0,
      created_at: data.created_at
    }

    return res.status(200).json({
      success: true,
      data: folder
    })

  } catch (error) {
    console.error('❌ Erro na API de criação de pasta:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao criar pasta',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
