// =====================================================
// API: LISTAR ARQUIVOS POR LEAD
// =====================================================
// Endpoint para obter lista de arquivos de mídia por lead
// Com paginação e filtros por tipo

import { createClient } from '@supabase/supabase-js'

// =====================================================
// CONFIGURAÇÃO SUPABASE
// =====================================================

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY

console.log('🔧 Configuração Supabase:', {
  hasUrl: !!supabaseUrl,
  hasKey: !!supabaseServiceKey,
  url: supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'MISSING'
})

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing:', { supabaseUrl, supabaseServiceKey })
  throw new Error('Configuração Supabase obrigatória')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =====================================================
// DADOS MOCK REMOVIDOS - APENAS DADOS REAIS
// =====================================================
// Função generateMockFiles removida - sistema agora usa apenas dados reais

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  console.log('🚀 PRODUÇÃO - API files.js CHAMADA:', {
    method: req.method,
    url: req.url,
    query: req.query,
    timestamp: new Date().toISOString()
  })

  // Apenas GET permitido
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas GET é permitido neste endpoint'
    })
  }

  try {
    const { leadId } = req.query
    const { 
      company_id, 
      file_type, 
      page = '1', 
      limit = '20',
      search = '',
      folder_id = null
    } = req.query

    // Validações básicas
    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório', 
        message: 'Parâmetro company_id é necessário'
      })
    }

    // Converter parâmetros
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const offset = (pageNum - 1) * limitNum

    console.log('📱 PRODUÇÃO - Buscando arquivos:', { 
      leadId, 
      company_id, 
      file_type, 
      page: pageNum, 
      limit: limitNum,
      search,
      folder_id,
      timestamp: new Date().toISOString(),
      supabaseConfigured: !!supabase
    })

    // =====================================================
    // LÓGICA CONDICIONAL: PASTA CHAT vs LEAD ESPECÍFICO
    // =====================================================

    let files = []
    let totalCount = 0

    // Verificar se é pasta Chat (buscar ID da pasta Chat)
    let isChatFolder = false
    console.log('🔍 DEBUG: Verificando folder_id recebido:', {
      folder_id,
      type: typeof folder_id,
      hasValue: !!folder_id
    })
    
    if (folder_id) {
      console.log('🔍 Verificando se é pasta Chat...')
      const { data: folderData, error: folderError } = await supabase
        .from('company_folders')
        .select('path, name, id')
        .eq('id', folder_id)
        .eq('company_id', company_id)
        .single()
      
      console.log('📁 DEBUG: Resultado da busca da pasta:', {
        folderData,
        folderError,
        searchedId: folder_id,
        company_id
      })
      
      if (folderData && folderData.path === '/chat') {
        isChatFolder = true
        console.log('💬 PASTA CHAT DETECTADA - Aplicando filtro S3 clientes/')
      } else if (folderData) {
        console.log('📁 Pasta encontrada mas NÃO é Chat:', folderData.path)
      } else {
        console.log('❌ Pasta não encontrada com ID:', folder_id)
      }
    } else {
      console.log('⚠️ folder_id não fornecido - usando lógica de lead específico')
    }

    console.log('🔍 Buscando dados reais na tabela lead_media_unified...')
    
    // Construir query base
    let query = supabase
      .from('lead_media_unified')
      .select(`
        id, original_filename, file_type, mime_type, file_size, 
        s3_key, preview_url, received_at, lead_id,
        ${isChatFolder ? 'leads!inner(name, phone)' : ''}
      `, { count: 'exact' })
      .eq('company_id', company_id)

    console.log('🔍 DEBUG: isChatFolder =', isChatFolder, 'leadId =', leadId)

    if (isChatFolder) {
      // PASTA CHAT: Redirecionar para novo endpoint de listagem S3 direta
      console.log('💬 PASTA CHAT DETECTADA - Redirecionando para listagem S3 direta')
      
      try {
        // Fazer chamada interna para o novo endpoint de Chat
        const chatApiUrl = `${req.headers.host}/api/media-library/chat/files?page=${pageNum}&limit=${limitNum}`
        
        // Repassar headers de autorização
        const authHeader = req.headers.authorization
        
        const chatResponse = await fetch(`http://${chatApiUrl}`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          }
        })
        
        if (!chatResponse.ok) {
          throw new Error(`Erro na API de Chat: ${chatResponse.status}`)
        }
        
        const chatData = await chatResponse.json()
        console.log('✅ Dados obtidos da API de Chat S3:', {
          totalFiles: chatData.stats?.total || 0,
          returnedFiles: chatData.files?.length || 0
        })
        
        return res.status(200).json(chatData)
        
      } catch (chatError) {
        console.error('❌ Erro ao chamar API de Chat S3:', chatError)
        // Fallback para método antigo se novo falhar
        query = query.like('s3_key', 'clientes/%')
        console.log('💬 FALLBACK: Usando método antigo para pasta Chat')
      }
      console.log('🔍 DEBUG: Aplicando filtro S3: s3_key LIKE clientes/%')
      
      // CORREÇÃO CRÍTICA: Forçar filtro adicional para garantir
      query = query.not('s3_key', 'like', 'biblioteca/%')
      console.log('🔍 DEBUG: Filtro adicional: NOT s3_key LIKE biblioteca/%')
    } else {
      // LEAD ESPECÍFICO: Buscar apenas mídias daquele lead
      if (!leadId) {
        return res.status(400).json({
          error: 'Lead ID obrigatório',
          message: 'Parâmetro leadId é necessário para consulta específica de lead'
        })
      }
      query = query.eq('lead_id', leadId)
      console.log('👤 Query para LEAD ESPECÍFICO:', leadId)
    }

    query = query.order('received_at', { ascending: false })

    // Filtrar por tipo se especificado
    if (file_type && ['image', 'video', 'audio', 'document'].includes(file_type)) {
      query = query.eq('file_type', file_type)
      console.log('🎯 Filtro por tipo aplicado:', file_type)
    }

    // Filtrar por busca se especificado
    if (search && search.trim()) {
      query = query.ilike('original_filename', `%${search.trim()}%`)
      console.log('🔍 Filtro de busca aplicado:', search.trim())
    }

    // Aplicar paginação
    query = query.range(offset, offset + limitNum - 1)
    
    console.log('📊 Query configurada:', {
      company_id,
      leadId,
      file_type: file_type || 'todos',
      search: search || 'sem filtro',
      offset,
      limit: limitNum
    })

    console.log('🔍 DEBUG: Query final construída, executando...')
    const { data, error, count } = await query

    console.log('📊 DEBUG: Resultado da query:', {
      dataCount: data?.length || 0,
      totalCount: count,
      error: error?.message,
      firstItem: data?.[0]?.s3_key || 'N/A'
    })

    if (error) {
      console.error('❌ ERRO na query Supabase:', {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      })
      
      // Se for erro de RLS ou permissão, tentar sem RLS
      console.log('🔄 Tentando query alternativa sem RLS...')
      try {
        const { data: altData, error: altError, count: altCount } = await supabase
          .from('lead_media_unified')
          .select('*', { count: 'exact' })
          .eq('company_id', company_id)
          .eq('lead_id', leadId)
          .order('received_at', { ascending: false })
          .range(offset, offset + limitNum - 1)
        
        if (altError) {
          console.error('❌ Erro também na query alternativa:', altError)
          throw altError
        }
        
        console.log('✅ Query alternativa funcionou!')
        files = altData || []
        totalCount = altCount || 0
        
      } catch (altDbError) {
        console.error('❌ Ambas queries falharam, retornando lista vazia:', altDbError.message)
        
        // Retornar lista vazia - SEM fallback mock
        files = []
        totalCount = 0
        
        console.log('✅ PRODUÇÃO - Retornando lista vazia (sem dados mock)')
      }
    } else {
      files = data || []
      totalCount = count || 0
      
      // CORREÇÃO CRÍTICA: Gerar URLs corretas do S3 para arquivos reais
      files = files.map(file => {
        let correctedS3Key = file.s3_key
        let previewUrl = file.preview_url
        
        // Corrigir chave S3 se tiver prefixo incorreto
        if (correctedS3Key && correctedS3Key.startsWith('supabase/')) {
          correctedS3Key = correctedS3Key.replace('supabase/', '')
        }
        
        // Gerar URL direta do S3 se não existir preview_url
        if (!previewUrl && correctedS3Key) {
          previewUrl = `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${correctedS3Key}`
        }
        
        return {
          ...file,
          s3_key: correctedS3Key,
          preview_url: previewUrl
        }
      })
      
      console.log('✅ PRODUÇÃO - DADOS REAIS OBTIDOS e URLs CORRIGIDAS:', {
        arquivos: files.length,
        totalCount,
        primeiroArquivo: files[0] ? {
          id: files[0].id,
          filename: files[0].original_filename,
          type: files[0].file_type,
          received_at: files[0].received_at,
          s3_key_original: data[0]?.s3_key,
          s3_key_corrigida: files[0].s3_key,
          preview_url: files[0].preview_url
        } : 'nenhum'
      })
    }

    // =====================================================
    // CALCULAR METADADOS DE PAGINAÇÃO
    // =====================================================

    const totalPages = Math.ceil(totalCount / limitNum)
    const hasNextPage = pageNum < totalPages
    const hasPrevPage = pageNum > 1

    console.log('✅ Arquivos obtidos:', {
      count: files.length,
      totalCount,
      page: pageNum,
      totalPages
    })

    // =====================================================
    // RESPOSTA
    // =====================================================

    return res.status(200).json({
      success: true,
      data: {
        files,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount,
          totalPages,
          hasNextPage,
          hasPrevPage
        },
        filters: {
          leadId,
          file_type: file_type || 'all',
          search: search || ''
        },
        lastUpdated: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('❌ Erro na API de arquivos por lead:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao buscar arquivos do lead',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
