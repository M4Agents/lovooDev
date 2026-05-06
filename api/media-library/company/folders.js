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
      parent_path: null,
      icon: '📢',
      description: 'Materiais de marketing e campanhas'
    },
    {
      company_id: companyId,
      name: 'Produtos',
      path: '/produtos',
      parent_path: null,
      icon: '📦',
      description: 'Imagens e documentos de produtos'
    },
    {
      company_id: companyId,
      name: 'Documentos',
      path: '/documentos',
      parent_path: null,
      icon: '📄',
      description: 'Documentos gerais da empresa'
    },
    {
      company_id: companyId,
      name: 'Templates',
      path: '/templates',
      parent_path: null,
      icon: '📋',
      description: 'Templates e modelos reutilizáveis'
    }
  ]
}

// =====================================================
// HELPER: CALCULAR PATH A PARTIR DO PARENT_PATH
// =====================================================

const buildFolderPath = (parentPath, folderName) => {
  const slug = folderName.toLowerCase().replace(/\s+/g, '_')
  if (!parentPath) {
    return `/${slug}`
  }
  return `${parentPath}/${slug}`
}

// =====================================================
// HELPER: BUSCAR PASTA PAI E RETORNAR PARENT_PATH
// =====================================================

const resolveParentPath = async (parentId, companyId) => {
  if (!parentId) return null

  const { data: parentFolder, error } = await supabase
    .from('company_folders')
    .select('path')
    .eq('id', parentId)
    .eq('company_id', companyId)
    .single()

  if (error || !parentFolder) {
    throw new Error('Pasta pai não encontrada ou não pertence a esta empresa')
  }

  return parentFolder.path
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  // Log para confirmar versão atualizada - 12/01/2026 10:50
  console.log('🔄 API FOLDERS ATUALIZADA - PUT/DELETE DISPONÍVEIS - 12/01/2026 10:50')
  console.log(`📡 Método: ${req.method} - Company: ${req.query.company_id}`)
  
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
        // Resolver parent_path a partir do parent_id (se informado)
        const parentPath = await resolveParentPath(parent_id, company_id)

        // Calcular path da nova pasta
        const path = buildFolderPath(parentPath, name.trim())

        // Verificar se já existe pasta com mesmo nome no mesmo nível (mesmo parent_path)
        const duplicateQuery = supabase
          .from('company_folders')
          .select('id')
          .eq('company_id', company_id)
          .eq('name', name.trim())

        if (parentPath === null) {
          duplicateQuery.is('parent_path', null)
        } else {
          duplicateQuery.eq('parent_path', parentPath)
        }

        const { data: existingFolder } = await duplicateQuery.maybeSingle()

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
            parent_path: parentPath,
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
    // PUT: EDITAR PASTA EXISTENTE
    // =====================================================

    if (req.method === 'PUT') {
      const { folder_id, name, icon, description } = req.body

      if (!folder_id) {
        return res.status(400).json({
          error: 'Folder ID obrigatório',
          message: 'O ID da pasta é obrigatório para edição'
        })
      }

      if (!name || !name.trim()) {
        return res.status(400).json({
          error: 'Nome obrigatório',
          message: 'O nome da pasta é obrigatório'
        })
      }

      console.log('✏️ Editando pasta:', { folder_id, name, company_id })

      try {
        // Verificar se pasta existe e pertence à empresa
        const { data: existingFolder, error: fetchError } = await supabase
          .from('company_folders')
          .select('*')
          .eq('id', folder_id)
          .eq('company_id', company_id)
          .single()

        if (fetchError || !existingFolder) {
          return res.status(404).json({
            error: 'Pasta não encontrada',
            message: 'Pasta não existe ou não pertence a esta empresa'
          })
        }

        // Bloquear edição de pastas de sistema
        if (existingFolder.is_system_folder) {
          return res.status(403).json({
            error: 'Pasta protegida',
            message: 'Esta pasta é gerenciada pelo sistema e não pode ser editada.'
          })
        }

        // Verificar se já existe pasta com mesmo nome no mesmo nível (exceto a própria pasta)
        const dupQuery = supabase
          .from('company_folders')
          .select('id')
          .eq('company_id', company_id)
          .eq('name', name.trim())
          .neq('id', folder_id)

        if (existingFolder.parent_path === null) {
          dupQuery.is('parent_path', null)
        } else {
          dupQuery.eq('parent_path', existingFolder.parent_path)
        }

        const { data: duplicateFolder } = await dupQuery.maybeSingle()

        if (duplicateFolder) {
          return res.status(400).json({
            error: 'Nome já existe',
            message: 'Já existe uma pasta com este nome neste local'
          })
        }

        // Recalcular path se nome mudou
        let newPath = existingFolder.path
        if (name.trim() !== existingFolder.name) {
          newPath = buildFolderPath(existingFolder.parent_path, name.trim())
        }

        // Atualizar pasta
        const { data, error } = await supabase
          .from('company_folders')
          .update({
            name: name.trim(),
            path: newPath,
            icon: icon || existingFolder.icon,
            description: description !== undefined ? description : existingFolder.description,
            updated_at: new Date().toISOString()
          })
          .eq('id', folder_id)
          .eq('company_id', company_id)
          .select()
          .single()

        if (error) {
          throw error
        }

        console.log('✅ Pasta editada com sucesso:', data.name, 'Path:', data.path)

        return res.status(200).json({
          success: true,
          data: data,
          message: 'Pasta editada com sucesso'
        })

      } catch (dbError) {
        console.error('❌ Erro ao editar pasta:', dbError)
        
        return res.status(500).json({
          error: 'Erro ao editar pasta',
          message: dbError.message || 'Erro interno do servidor'
        })
      }
    }

    // =====================================================
    // DELETE: EXCLUIR PASTA COM VALIDAÇÕES
    // =====================================================

    if (req.method === 'DELETE') {
      const { folder_id } = req.body

      if (!folder_id) {
        return res.status(400).json({
          error: 'Folder ID obrigatório',
          message: 'O ID da pasta é obrigatório para exclusão'
        })
      }

      console.log('🗑️ Tentando excluir pasta:', { folder_id, company_id })

      try {
        // Verificar se pasta existe e pertence à empresa
        const { data: existingFolder, error: fetchError } = await supabase
          .from('company_folders')
          .select('*')
          .eq('id', folder_id)
          .eq('company_id', company_id)
          .single()

        if (fetchError || !existingFolder) {
          return res.status(404).json({
            error: 'Pasta não encontrada',
            message: 'Pasta não existe ou não pertence a esta empresa'
          })
        }

        // Verificar se pasta tem subpastas (usando parent_path = path da pasta atual)
        const { data: subfolders, error: subfoldersError } = await supabase
          .from('company_folders')
          .select('id, name')
          .eq('company_id', company_id)
          .eq('parent_path', existingFolder.path)

        if (subfoldersError) {
          throw subfoldersError
        }

        if (subfolders && subfolders.length > 0) {
          return res.status(400).json({
            error: 'Pasta contém subpastas',
            message: `Não é possível excluir. A pasta contém ${subfolders.length} subpasta(s)`,
            details: {
              type: 'has_subfolders',
              count: subfolders.length,
              subfolders: subfolders.map(f => f.name)
            }
          })
        }

        // Verificar se pasta tem arquivos na company_media_library
        const { data: companyFiles, error: companyFilesError } = await supabase
          .from('company_media_library')
          .select('id, original_filename')
          .eq('company_id', company_id)
          .eq('folder_id', folder_id)

        if (companyFilesError) {
          console.warn('⚠️ Erro ao verificar company_media_library:', companyFilesError)
        }

        const companyFilesCount = companyFiles ? companyFiles.length : 0

        // Verificar se pasta tem arquivos na lead_media_unified
        const { data: leadFiles, error: leadFilesError } = await supabase
          .from('lead_media_unified')
          .select('id, original_filename')
          .eq('company_id', company_id)
          .eq('folder_id', folder_id)

        if (leadFilesError) {
          console.warn('⚠️ Erro ao verificar lead_media_unified:', leadFilesError)
        }

        const leadFilesCount = leadFiles ? leadFiles.length : 0
        const totalFiles = companyFilesCount + leadFilesCount

        if (totalFiles > 0) {
          return res.status(400).json({
            error: 'Pasta contém arquivos',
            message: `Não é possível excluir. A pasta contém ${totalFiles} arquivo(s)`,
            details: {
              type: 'has_files',
              total_files: totalFiles,
              company_files: companyFilesCount,
              lead_files: leadFilesCount
            }
          })
        }

        // Pasta está vazia, pode excluir
        const { error: deleteError } = await supabase
          .from('company_folders')
          .delete()
          .eq('id', folder_id)
          .eq('company_id', company_id)

        if (deleteError) {
          throw deleteError
        }

        console.log('✅ Pasta excluída com sucesso:', existingFolder.name)

        return res.status(200).json({
          success: true,
          message: `Pasta "${existingFolder.name}" excluída com sucesso`,
          data: {
            deleted_folder: existingFolder
          }
        })

      } catch (dbError) {
        console.error('❌ Erro ao excluir pasta:', dbError)
        
        return res.status(500).json({
          error: 'Erro ao excluir pasta',
          message: dbError.message || 'Erro interno do servidor'
        })
      }
    }

    // =====================================================
    // MÉTODO NÃO PERMITIDO
    // =====================================================

    return res.status(405).json({
      error: 'Method not allowed',
      message: 'Apenas GET, POST, PUT e DELETE são permitidos neste endpoint'
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
