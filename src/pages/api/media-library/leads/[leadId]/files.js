// =====================================================
// API: ARQUIVOS DE MÍDIA POR LEAD - CONEXÃO S3 REAL
// =====================================================
// Endpoint usando S3Storage.listObjects() para buscar arquivos reais
// Atualizado: 20/02/2026 17:33 - Conectar com AWS S3 real

import { createClient } from '@supabase/supabase-js'
import { S3Storage } from '@/services/aws/s3Storage'

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
    image: ['produto_foto.jpg', 'banner_promocao.png', 'logo_empresa.webp'],
    video: ['demo_produto.mp4', 'apresentacao.mov', 'tutorial.avi'],
    audio: ['audio_whatsapp.ogg', 'gravacao_reuniao.mp3'],
    document: ['contrato.pdf', 'proposta_comercial.docx', 'planilha_precos.xlsx']
  }
  
  const mimeTypes = {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    video: ['video/mp4', 'video/mov', 'video/avi'],
    audio: ['audio/ogg', 'audio/mp3', 'audio/wav'],
    document: ['application/pdf', 'application/msword']
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
      file_size: Math.floor(Math.random() * 10000000) + 100000,
      s3_key: `clientes/mock_company/whatsapp/2026/01/10/mock_file_${i}`,
      preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/mock_preview_${i}`,
      received_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      lead_id: parseInt(leadId) || 1,
      created_at: new Date().toISOString()
    }
    
    mockFiles.push(file)
  }
  
  return mockFiles.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  // LOG IDENTIFICADOR PARA CONEXÃO DIRETA S3
  console.log('🔥 FILES API - 2026-01-10 09:27 - CONEXÃO DIRETA COM S3 REAL')
  console.log('✅ ESTRUTURA: biblioteca/ e clientes/ - SEM ERROS SQL')
  
  try {

    // Apenas GET permitido
    if (req.method !== 'GET') {
      return res.status(405).json({ 
        error: 'Method not allowed',
        message: 'Apenas GET é permitido neste endpoint'
      })
    }

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

    console.log('📱 V2 - Buscando arquivos:', { 
      leadId, 
      company_id, 
      file_type, 
      page: pageNum, 
      limit: limitNum,
      search,
      folder_id
    })

    let files = []
    let totalCount = 0

    console.log('� CONEXÃO S3 REAL - 2026-02-20 17:33 - USANDO S3Storage.listObjects()')
    console.log('� Buscando arquivos reais do WhatsApp no AWS S3...')
    
    // BUSCAR ARQUIVOS REAIS DO S3 USANDO S3Storage.listObjects()
    try {
      const prefix = `clientes/${company_id}/whatsapp/`
      console.log('🔍 Prefix S3:', prefix)
      
      const s3Result = await S3Storage.listObjects(company_id, prefix)
      
      if (s3Result.success && s3Result.data) {
        console.log('✅ S3Storage.listObjects() - Arquivos encontrados:', s3Result.data.length)
        
        // Aplicar filtros se necessário
        let filteredFiles = s3Result.data
        
        // Filtrar por tipo de arquivo se especificado
        if (file_type && file_type !== 'all') {
          filteredFiles = filteredFiles.filter(f => f.file_type === file_type)
          console.log('🔍 Filtrado por tipo:', file_type, '- Resultado:', filteredFiles.length)
        }
        
        // Filtrar por busca se especificado
        if (search && search.trim()) {
          const searchLower = search.toLowerCase()
          filteredFiles = filteredFiles.filter(f => 
            f.original_filename.toLowerCase().includes(searchLower)
          )
          console.log('🔍 Filtrado por busca:', search, '- Resultado:', filteredFiles.length)
        }
        
        // Aplicar paginação
        totalCount = filteredFiles.length
        files = filteredFiles.slice(offset, offset + limitNum)
        
        console.log('✅ ARQUIVOS REAIS DO S3:', {
          total: totalCount,
          page: pageNum,
          returned: files.length
        })
      } else {
        console.error('❌ Erro ao buscar S3:', s3Result.error)
        files = []
        totalCount = 0
      }
    } catch (s3Error) {
      console.error('❌ Exception ao buscar S3:', s3Error)
      files = []
      totalCount = 0
    }

    // =====================================================
    // CALCULAR METADADOS DE PAGINAÇÃO
    // =====================================================

    const totalPages = Math.ceil(totalCount / limitNum)
    const hasNextPage = pageNum < totalPages
    const hasPrevPage = pageNum > 1

    console.log('✅ V2 - Arquivos obtidos:', {
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
    console.error('❌ Erro na API V2 de arquivos:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao buscar arquivos do lead',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
