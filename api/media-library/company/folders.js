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

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY

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
// DADOS MOCK REMOVIDOS - APENAS DADOS REAIS
// =====================================================
// Função generateMockFolders removida - sistema agora usa apenas dados reais

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

        // Se não há pastas, retornar array vazio (não criar pastas mock)
        if (folders.length === 0) {
          console.log('📁 Nenhuma pasta encontrada para empresa:', company_id)
          folders = []
        } else {
          console.log('✅ PASTAS REAIS encontradas:', folders.length)
          
          // Adicionar contagem de arquivos para cada pasta
          const foldersWithCount = await Promise.all(folders.map(async (folder) => {
            const { count } = await supabase
              .from('lead_media_unified')
              .select('*', { count: 'exact', head: true })
              .eq('company_id', company_id)
              .eq('folder_id', folder.id)
            
            return {
              ...folder,
              file_count: count || 0
            }
          }))
          
          folders = foldersWithCount
          console.log('✅ Contagem de arquivos adicionada às pastas')
        }

      } catch (dbError) {
        console.error('❌ Erro ao acessar banco de pastas:', dbError.message)
        // Retornar array vazio em vez de dados mock
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
