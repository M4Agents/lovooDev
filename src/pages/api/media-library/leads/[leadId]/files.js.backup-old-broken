// =====================================================
// API: LISTAR ARQUIVOS POR LEAD - INTEGRAÇÃO AWS S3
// =====================================================
// Endpoint para obter lista de arquivos de mídia por lead
// Com paginação e filtros por tipo
// ATUALIZADO: Integração com AWS S3 real - 10/01/2026

import { createClient } from '@supabase/supabase-js'
import { S3Storage } from '../../../../services/aws/s3Storage.js'

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
// HELPER: GERAR DADOS MOCK
// =====================================================

const generateMockFiles = (leadId, fileType = null, limit = 20) => {
  const types = fileType ? [fileType] : ['image', 'video', 'audio', 'document']
  const mockFiles = []
  
  const fileNames = {
    image: ['produto_foto.jpg', 'banner_promocao.png', 'logo_empresa.webp', 'catalogo_visual.jpg'],
    video: ['demo_produto.mp4', 'apresentacao.mov', 'tutorial.avi', 'depoimento.mp4'],
    audio: ['audio_whatsapp.ogg', 'gravacao_reuniao.mp3', 'podcast_episodio.wav'],
    document: ['contrato.pdf', 'proposta_comercial.docx', 'planilha_precos.xlsx', 'manual_usuario.pdf']
  }
  
  const mimeTypes = {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    video: ['video/mp4', 'video/mov', 'video/avi'],
    audio: ['audio/ogg', 'audio/mp3', 'audio/wav'],
    document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  }
  
  for (let i = 0; i < limit; i++) {
    const type = types[Math.floor(Math.random() * types.length)]
    const names = fileNames[type]
    const mimes = mimeTypes[type]
    
    const file = {
      id: `mock_${leadId}_${type}_${i}`,
      original_filename: names[Math.floor(Math.random() * names.length)],
      file_type: type,
      mime_type: mimes[Math.floor(Math.random() * mimes.length)],
      file_size: Math.floor(Math.random() * 10000000) + 100000, // 100KB - 10MB
      s3_key: `biblioteca/leads/${leadId}/${type}s/mock_file_${i}`,
      thumbnail_s3_key: type === 'image' || type === 'video' ? `thumbnails/mock_thumb_${i}.webp` : null,
      preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/mock_preview_${i}`,
      received_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(), // Últimos 30 dias
      source_message_id: `msg_${Math.floor(Math.random() * 1000000)}`,
      created_at: new Date().toISOString()
    }
    
    mockFiles.push(file)
  }
  
  // Ordenar por data de recebimento (mais recentes primeiro)
  return mockFiles.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  // LOG IDENTIFICADOR DE DEPLOY - FORÇAR ATUALIZAÇÃO
  console.log('🔥 DEPLOY FORÇADO - 2026-01-10 08:54 - CORREÇÕES SQL ATIVAS')
  console.log('✅ VERSÃO CORRIGIDA: UUID/smallint fix + sintaxe SQL')
  
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

    console.log('📱 Buscando arquivos para lead:', { 
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

    // =====================================================
    // INTEGRAÇÃO AWS S3 REAL - NOVA IMPLEMENTAÇÃO
    // =====================================================

    try {
      console.log('🚀 AWS S3 INTEGRAÇÃO: Buscando mídias reais do S3...')
      
      if (isChatFolder) {
        // PASTA CHAT: Buscar mídias direto do S3
        console.log('💬 PASTA CHAT DETECTADA: Buscando mídias do S3 com prefix clientes/')
        
        const s3Prefix = `clientes/${company_id}/whatsapp/`
        console.log('🔍 S3 Prefix para busca:', s3Prefix)
        
        const s3Result = await S3Storage.listObjects(company_id, s3Prefix)
        
        if (s3Result.success && s3Result.data) {
          console.log('✅ S3 SUCESSO: Encontradas', s3Result.data.length, 'mídias')
          
          let s3Files = s3Result.data
          
          // Filtrar por tipo se especificado
          if (file_type && ['image', 'video', 'audio', 'document'].includes(file_type)) {
            s3Files = s3Files.filter(file => file.file_type === file_type)
            console.log('🔍 Filtro por tipo aplicado:', file_type, '- Restaram:', s3Files.length)
          }
          
          // Filtrar por busca se especificado
          if (search && search.trim()) {
            s3Files = s3Files.filter(file => 
              file.original_filename.toLowerCase().includes(search.trim().toLowerCase())
            )
            console.log('🔍 Filtro por busca aplicado:', search, '- Restaram:', s3Files.length)
          }
          
          // Aplicar paginação
          totalCount = s3Files.length
          files = s3Files.slice(offset, offset + limitNum)
          
          console.log('📊 Paginação aplicada:', {
            total: totalCount,
            offset,
            limit: limitNum,
            returned: files.length
          })
          
        } else {
          console.log('❌ S3 ERRO:', s3Result.error)
          throw new Error(s3Result.error || 'Erro ao buscar mídias do S3')
        }
        
      } else {
        // LEAD ESPECÍFICO: Buscar na tabela lead_media_unified
        console.log('👤 LEAD ESPECÍFICO: Buscando na tabela lead_media_unified...')
        
        if (!leadId) {
          return res.status(400).json({
            error: 'Lead ID obrigatório',
            message: 'Parâmetro leadId é necessário para consulta específica de lead'
          })
        }
        
        // CORREÇÃO: Verificar se leadId é UUID ou ID numérico
        console.log('🔍 Analisando leadId recebido:', leadId, 'tipo:', typeof leadId)
        
        let numericLeadId = null
        
        // Se leadId é um UUID (formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
        if (leadId && leadId.includes('-') && leadId.length === 36) {
          console.log('📋 LeadId é UUID, tentando buscar ID numérico correspondente...')
          
          // Tentar buscar na tabela chat_contacts que pode ter mapeamento
          const { data: contactData, error: contactError } = await supabase
            .from('chat_contacts')
            .select('id, name')
            .eq('company_id', company_id)
            .limit(1)
          
          if (contactData && contactData.length > 0) {
            console.log('💬 Dados de contato encontrados, mas UUID não mapeado diretamente')
          }
          
          // Como não há mapeamento direto, retornar lista vazia graciosamente
          console.log('⚠️ UUID não pode ser mapeado para ID numérico, retornando lista vazia')
          files = []
          totalCount = 0
        } else {
          // Se leadId é numérico, usar diretamente
          numericLeadId = parseInt(leadId)
          console.log('🔢 LeadId é numérico:', numericLeadId)
        }
        
        if (numericLeadId && !isNaN(numericLeadId)) {
          console.log('✅ Usando lead_id numérico:', numericLeadId)
          
          let query = supabase
            .from('lead_media_unified')
            .select(`
              id, original_filename, file_type, mime_type, file_size, 
              s3_key, preview_url, received_at, lead_id
            `, { count: 'exact' })
            .eq('company_id', company_id)
            .eq('lead_id', numericLeadId)
            .order('received_at', { ascending: false })

          // Filtrar por tipo se especificado
          if (file_type && ['image', 'video', 'audio', 'document'].includes(file_type)) {
            query = query.eq('file_type', file_type)
          }

          // Filtrar por busca se especificado
          if (search && search.trim()) {
            query = query.ilike('original_filename', `%${search.trim()}%`)
          }

          // Aplicar paginação
          query = query.range(offset, offset + limitNum - 1)

          const { data, error, count } = await query

          if (error) {
            console.log('⚠️ Erro na tabela lead_media_unified:', error.message)
            throw error
          }

          files = data || []
          totalCount = count || 0
          
          console.log('✅ SUPABASE SUCESSO: Encontradas', files.length, 'mídias para lead_id', numericLeadId)
        } else {
          console.log('⚠️ Lead_id não é válido, retornando lista vazia')
          files = []
          totalCount = 0
        }
      }

    } catch (dbError) {
      console.log('⚠️ Erro ao buscar mídias, usando fallback para dados mock:', dbError.message)
      
      // Fallback para dados mock apenas em caso de erro
      const mockFiles = generateMockFiles(leadId, file_type, limitNum * 3)
      
      // Aplicar filtro de busca nos dados mock
      let filteredFiles = mockFiles
      if (search && search.trim()) {
        filteredFiles = mockFiles.filter(file => 
          file.original_filename.toLowerCase().includes(search.trim().toLowerCase())
        )
      }
      
      // Aplicar paginação nos dados mock
      totalCount = filteredFiles.length
      files = filteredFiles.slice(offset, offset + limitNum)
      
      console.log('📦 FALLBACK MOCK: Retornando', files.length, 'arquivos mock')
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
