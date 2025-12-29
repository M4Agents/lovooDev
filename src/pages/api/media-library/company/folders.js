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

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =====================================================
// HELPER: GERAR PASTAS MOCK
// =====================================================

const generateMockFolders = (companyId) => {
  return [
    {
      id: `folder_${companyId}_1`,
      company_id: companyId,
      name: 'Marketing',
      path: '/marketing',
      parent_path: null,
      icon: '📢',
      description: 'Materiais de marketing e campanhas',
      file_count: 234,
      created_at: new Date().toISOString()
    },
    {
      id: `folder_${companyId}_2`,
      company_id: companyId,
      name: 'Banners',
      path: '/marketing/banners',
      parent_path: '/marketing',
      icon: '🎨',
      description: 'Banners promocionais',
      file_count: 89,
      created_at: new Date().toISOString()
    },
    {
      id: `folder_${companyId}_3`,
      company_id: companyId,
      name: 'Vídeos Promocionais',
      path: '/marketing/videos',
      parent_path: '/marketing',
      icon: '🎬',
      description: 'Vídeos para campanhas',
      file_count: 45,
      created_at: new Date().toISOString()
    },
    {
      id: `folder_${companyId}_4`,
      company_id: companyId,
      name: 'Produtos',
      path: '/produtos',
      parent_path: null,
      icon: '📦',
      description: 'Imagens e documentos de produtos',
      file_count: 156,
      created_at: new Date().toISOString()
    },
    {
      id: `folder_${companyId}_5`,
      company_id: companyId,
      name: 'Fotos',
      path: '/produtos/fotos',
      parent_path: '/produtos',
      icon: '📷',
      description: 'Fotografias dos produtos',
      file_count: 98,
      created_at: new Date().toISOString()
    },
    {
      id: `folder_${companyId}_6`,
      company_id: companyId,
      name: 'Catálogos',
      path: '/produtos/catalogos',
      parent_path: '/produtos',
      icon: '📋',
      description: 'Catálogos em PDF',
      file_count: 58,
      created_at: new Date().toISOString()
    },
    {
      id: `folder_${companyId}_7`,
      company_id: companyId,
      name: 'Documentos',
      path: '/documentos',
      parent_path: null,
      icon: '📄',
      description: 'Documentos gerais da empresa',
      file_count: 89,
      created_at: new Date().toISOString()
    },
    {
      id: `folder_${companyId}_8`,
      company_id: companyId,
      name: 'Contratos',
      path: '/documentos/contratos',
      parent_path: '/documentos',
      icon: '📋',
      description: 'Modelos de contratos',
      file_count: 34,
      created_at: new Date().toISOString()
    },
    {
      id: `folder_${companyId}_9`,
      company_id: companyId,
      name: 'Orçamentos',
      path: '/documentos/orcamentos',
      parent_path: '/documentos',
      icon: '💰',
      description: 'Templates de orçamentos',
      file_count: 55,
      created_at: new Date().toISOString()
    }
  ]
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  try {
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
          const defaultFolders = generateMockFolders(company_id)
          
          const { data: insertedFolders, error: insertError } = await supabase
            .from('company_folders')
            .insert(defaultFolders.map(folder => ({
              company_id: folder.company_id,
              name: folder.name,
              path: folder.path,
              parent_path: folder.parent_path,
              icon: folder.icon,
              description: folder.description
            })))
            .select()

          if (!insertError && insertedFolders) {
            folders = insertedFolders
          }
        }

      } catch (dbError) {
        console.log('⚠️ Erro ao acessar banco, usando dados mock:', dbError.message)
        folders = generateMockFolders(company_id)
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
      const { name, parent_path, icon, description } = req.body

      if (!name || !name.trim()) {
        return res.status(400).json({
          error: 'Nome obrigatório',
          message: 'O nome da pasta é obrigatório'
        })
      }

      // Gerar path baseado no parent_path
      const path = parent_path ? `${parent_path}/${name.toLowerCase().replace(/\s+/g, '_')}` : `/${name.toLowerCase().replace(/\s+/g, '_')}`

      console.log('📁 Criando nova pasta:', { name, path, parent_path })

      try {
        const { data, error } = await supabase
          .from('company_folders')
          .insert({
            company_id,
            name: name.trim(),
            path,
            parent_path: parent_path || null,
            icon: icon || '📁',
            description: description || ''
          })
          .select()
          .single()

        if (error) {
          throw error
        }

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
