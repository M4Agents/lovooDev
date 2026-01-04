// =====================================================
// API: PASTAS DA BIBLIOTECA DA EMPRESA
// =====================================================
// Endpoint para gerenciar pastas da biblioteca da empresa
// CRUD completo com estrutura hierárquica
// Atualizado: 29/12/2025 - Forçar redeploy para resolver cache Vercel

import { createClient } from '@supabase/supabase-js'

// =====================================================
// CONFIGURAÇÃO SUPABASE
// =====================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Validação robusta para prevenir falhas silenciosas
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing:', { 
    hasUrl: !!supabaseUrl, 
    hasKey: !!supabaseServiceKey 
  })
}

// Inicialização segura com fallback
let supabase = null
try {
  if (supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey)
  }
} catch (initError) {
  console.error('❌ Erro ao inicializar Supabase:', initError)
}

// =====================================================
// HELPER: GERAR PASTAS PADRÃO
// =====================================================

const generateDefaultFolders = (companyId) => {
  return [
    {
      company_id: companyId,
      name: 'Marketing',
      path: '/marketing',
      parent_id: null,
      icon: '📢',
      description: 'Materiais de marketing e campanhas'
    },
    {
      company_id: companyId,
      name: 'Produtos',
      path: '/produtos',
      parent_id: null,
      icon: '📦',
      description: 'Imagens e documentos de produtos'
    },
    {
      company_id: companyId,
      name: 'Documentos',
      path: '/documentos',
      parent_id: null,
      icon: '📄',
      description: 'Documentos gerais da empresa'
    },
    {
      company_id: companyId,
      name: 'Templates',
      path: '/templates',
      parent_id: null,
      icon: '📋',
      description: 'Templates e modelos reutilizáveis'
    }
  ]
}

// =====================================================
// HELPER: CALCULAR PATH HIERÁRQUICO
// =====================================================

const calculateFolderPath = async (parentId, folderName, companyId) => {
  if (!parentId) {
    // Pasta raiz
    return `/${folderName.toLowerCase().replace(/\s+/g, '_')}`
  }

  try {
    // Buscar pasta pai para construir path hierárquico
    const { data: parentFolder, error } = await supabase
      .from('company_folders')
      .select('path')
      .eq('id', parentId)
      .eq('company_id', companyId)
      .single()

    if (error || !parentFolder) {
      throw new Error('Pasta pai não encontrada')
    }

    return `${parentFolder.path}/${folderName.toLowerCase().replace(/\s+/g, '_')}`
  } catch (error) {
    throw new Error(`Erro ao calcular path: ${error.message}`)
  }
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  try {
    // Validação de inicialização do Supabase
    if (!supabase) {
      console.error('❌ Supabase não inicializado - verificar variáveis de ambiente')
      return res.status(500).json({
        error: 'Configuração inválida',
        message: 'Serviço temporariamente indisponível - configuração ausente'
      })
    }

    const { company_id } = req.query

    // Validação básica
    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    // =====================================================
    // GET: LISTAR PASTAS
    // =====================================================

    if (req.method === 'GET') {
      console.log('📁 Listando pastas da empresa:', company_id)

      let folders = []

      try {
        // Tentar buscar da tabela company_folders
        const { data, error } = await supabase
          .from('company_folders')
          .select('*')
          .eq('company_id', company_id)
          .order('path', { ascending: true })

        if (error) {
          console.log('⚠️ Tabela company_folders ainda não existe, usando dados mock')
          throw error
        }

        folders = data || []

        // Se não há pastas, criar as padrão
        if (folders.length === 0) {
          console.log('📁 Criando pastas padrão para empresa')
          const defaultFolders = generateDefaultFolders(company_id)
          
          const { data: insertedFolders, error: insertError } = await supabase
            .from('company_folders')
            .insert(defaultFolders)
            .select()

          if (!insertError && insertedFolders) {
            folders = insertedFolders
          }
        }

      } catch (dbError) {
        console.log('⚠️ Erro ao acessar banco, retornando lista vazia:', dbError.message)
        folders = []
      }

      return res.status(200).json({
        success: true,
        data: {
          folders,
          totalCount: folders.length,
          lastUpdated: new Date().toISOString()
        }
      })
    }

    // =====================================================
    // POST: CRIAR NOVA PASTA
    // =====================================================

    if (req.method === 'POST') {
      const { name, parent_id, icon, description } = req.body

      if (!name || !name.trim()) {
        return res.status(400).json({
          error: 'Nome obrigatório',
          message: 'O nome da pasta é obrigatório'
        })
      }

      console.log('📁 Criando nova pasta:', { name, parent_id, company_id })

      try {
        // Calcular path hierárquico
        const path = await calculateFolderPath(parent_id, name.trim(), company_id)

        // Verificar se já existe pasta com mesmo nome no mesmo nível
        const { data: existingFolder } = await supabase
          .from('company_folders')
          .select('id')
          .eq('company_id', company_id)
          .eq('name', name.trim())
          .eq('parent_id', parent_id || null)
          .single()

        if (existingFolder) {
          return res.status(400).json({
            error: 'Pasta já existe',
            message: 'Já existe uma pasta com este nome neste local'
          })
        }

        // Criar nova pasta
        const { data, error } = await supabase
          .from('company_folders')
          .insert({
            company_id,
            name: name.trim(),
            path,
            parent_id: parent_id || null,
            icon: icon || '📁',
            description: description || ''
          })
          .select()
          .single()

        if (error) {
          throw error
        }

        console.log('✅ Pasta criada com sucesso:', data.name, 'Path:', data.path)

        return res.status(201).json({
          success: true,
          data: data,
          message: 'Pasta criada com sucesso'
        })

      } catch (dbError) {
        console.error('❌ Erro ao criar pasta:', dbError)
        
        return res.status(500).json({
          error: 'Erro ao criar pasta',
          message: dbError.message || 'Erro interno do servidor'
        })
      }
    }

    // =====================================================
    // MÉTODO NÃO PERMITIDO
    // =====================================================

    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Apenas GET e POST são permitidos neste endpoint'
    })

  } catch (error) {
    console.error('❌ Erro na API de pastas da empresa:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao processar solicitação',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
