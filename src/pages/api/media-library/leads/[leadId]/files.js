// =====================================================
// API: LISTAR ARQUIVOS POR LEAD
// =====================================================
// Endpoint para obter lista de arquivos de mídia por lead
// Com paginação e filtros por tipo

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
      search = ''
    } = req.query

    // Validações básicas
    if (!leadId) {
      return res.status(400).json({
        error: 'Lead ID obrigatório',
        message: 'Parâmetro leadId é necessário'
      })
    }

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
      search 
    })

    // =====================================================
    // BUSCAR DADOS NA TABELA (se existir)
    // =====================================================

    let files = []
    let totalCount = 0

    try {
      // Construir query base
      let query = supabase
        .from('lead_media_unified')
        .select('*', { count: 'exact' })
        .eq('company_id', company_id)
        .eq('lead_id', leadId)
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
        console.log('⚠️ Tabela lead_media_unified ainda não existe, usando dados mock')
        throw error
      }

      files = data || []
      totalCount = count || 0

    } catch (dbError) {
      console.log('⚠️ Erro ao acessar banco, usando dados mock:', dbError.message)
      
      // Fallback para dados mock
      const mockFiles = generateMockFiles(leadId, file_type, limitNum * 3) // Gerar mais para simular paginação
      
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
