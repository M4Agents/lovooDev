// =====================================================
// MEDIA MANAGEMENT - LISTAR ARQUIVOS
// =====================================================
// API para listar arquivos de uma pasta

import { createClient } from '@supabase/supabase-js'
import { generatePresignedUrl } from '../utils/s3-presigned.js'

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
    const { 
      company_id, 
      folder_id,
      file_type, 
      page = '1', 
      limit = '50',
      search = '',
      sort_by = 'date',
      sort_order = 'desc'
    } = req.query

    // Validações
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

    console.log('📄 Buscando arquivos AWS S3:', { 
      company_id, 
      folder_id, 
      file_type, 
      page: pageNum, 
      limit: limitNum,
      search,
      sort_by,
      sort_order,
      filter: 'Apenas arquivos no AWS S3 (excluindo URLs externas)'
    })

    // Buscar apenas arquivos que estão realmente no AWS S3
    // Excluir URLs externas (WhatsApp, UAZ API, etc.)
    let query = supabase
      .from('lead_media_unified')
      .select('*', { count: 'exact' })
      .eq('company_id', company_id)
      .not('s3_key', 'like', 'supabase/https://%')

    // Filtrar por tipo se especificado
    if (file_type && ['image', 'video', 'audio', 'document'].includes(file_type)) {
      query = query.eq('file_type', file_type)
    }

    // Filtrar por busca se especificado
    if (search && search.trim()) {
      query = query.ilike('original_filename', `%${search.trim()}%`)
    }

    // Ordenação
    const orderColumn = sort_by === 'name' ? 'original_filename' : 
                       sort_by === 'size' ? 'file_size' : 
                       sort_by === 'type' ? 'file_type' : 'created_at'
    
    query = query.order(orderColumn, { ascending: sort_order === 'asc' })

    // Aplicar paginação
    query = query.range(offset, offset + limitNum - 1)

    const { data, error, count } = await query

    if (error) {
      console.error('❌ Erro ao buscar arquivos:', error)
      return res.status(500).json({
        error: 'Erro ao buscar arquivos',
        message: error.message
      })
    }

    // Processar arquivos e gerar presigned URLs
    const files = await Promise.all((data || []).map(async (file) => {
      let correctedS3Key = file.s3_key
      let previewUrl = file.preview_url

      // Corrigir chave S3 se tiver prefixo incorreto
      if (correctedS3Key && correctedS3Key.startsWith('supabase/')) {
        correctedS3Key = correctedS3Key.replace('supabase/', '')
      }

      // Gerar presigned URL segura se não existir preview_url
      if (!previewUrl && correctedS3Key) {
        try {
          previewUrl = await generatePresignedUrl(correctedS3Key, 3600) // 1 hora de validade
          console.log('✅ Presigned URL gerada para:', file.original_filename)
        } catch (error) {
          console.error('❌ Erro ao gerar presigned URL para:', file.original_filename, error.message)
          previewUrl = null // Manter null se não conseguir gerar
        }
      }

      return {
        id: file.id,
        original_filename: file.original_filename,
        file_type: file.file_type,
        mime_type: file.mime_type,
        file_size: file.file_size,
        s3_key: correctedS3Key,
        thumbnail_s3_key: file.thumbnail_s3_key,
        preview_url: previewUrl,
        received_at: file.received_at,
        source_message_id: file.source_message_id,
        created_at: file.created_at,
        folder_id: folder_id || null,
        folder_path: null,
        uploaded_by: null,
        tags: [],
        is_favorite: false
      }
    }))

    const totalCount = count || 0
    const totalPages = Math.ceil(totalCount / limitNum)
    const hasNextPage = pageNum < totalPages
    const hasPrevPage = pageNum > 1

    console.log('✅ Arquivos AWS S3 obtidos:', files.length, '(URLs externas filtradas)')

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
        folder: folder_id ? { id: folder_id } : null
      }
    })

  } catch (error) {
    console.error('❌ Erro na API de listagem de arquivos:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao buscar arquivos',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
