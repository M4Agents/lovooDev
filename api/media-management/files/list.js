// =====================================================
// MEDIA MANAGEMENT - LISTAR ARQUIVOS
// =====================================================
// API para listar arquivos de uma pasta

import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Supabase configuration missing')
}

// Cliente anon para lead_media_unified (fluxo existente)
const supabase = createClient(supabaseUrl, supabaseAnonKey)
// Cliente service role para company_media_library (bypassa RLS)
const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null

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

    const orderColumn = sort_by === 'name' ? 'original_filename'
      : sort_by === 'size' ? 'file_size'
      : sort_by === 'type' ? 'file_type'
      : 'created_at'

    // Resolver metadados da pasta quando folder_id informado
    let folderMeta = null
    if (folder_id) {
      const { data: fd } = await supabase
        .from('company_folders')
        .select('id, path, is_system_folder')
        .eq('id', folder_id)
        .eq('company_id', company_id)
        .single()
      folderMeta = fd
    }

    // ── 1. Arquivos de lead_media_unified (biblioteca geral) ────────────────
    let leadQuery = supabase
      .from('lead_media_unified')
      .select('*', { count: 'exact' })
      .eq('company_id', company_id)
      .not('s3_key', 'like', 'supabase/https://%')

    if (folder_id) {
      leadQuery = leadQuery.eq('folder_id', folder_id)
    }

    if (file_type && ['image', 'video', 'audio', 'document'].includes(file_type)) {
      leadQuery = leadQuery.eq('file_type', file_type)
    }

    if (search && search.trim()) {
      leadQuery = leadQuery.ilike('original_filename', `%${search.trim()}%`)
    }

    leadQuery = leadQuery.order(orderColumn, { ascending: sort_order === 'asc' })

    if (!folder_id) {
      // Paginação só quando sem pasta (evitar offset incorreto no merge)
      leadQuery = leadQuery.range(offset, offset + limitNum - 1)
    }

    const { data: leadData, error: leadError, count: leadCount } = await leadQuery

    if (leadError) {
      console.error('❌ Erro ao buscar lead_media_unified:', leadError)
      return res.status(500).json({ error: 'Erro ao buscar arquivos', message: leadError.message })
    }

    const mapLeadFile = (file) => {
      let correctedS3Key = file.s3_key
      let previewUrl = file.preview_url
      if (correctedS3Key && correctedS3Key.startsWith('supabase/')) {
        correctedS3Key = correctedS3Key.replace('supabase/', '')
      }
      if (!previewUrl && file.original_filename) {
        previewUrl = `/api/s3-media/${encodeURIComponent(file.original_filename)}`
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
        folder_id: file.folder_id,
        folder_path: null,
        uploaded_by: null,
        tags: [],
        is_favorite: false
      }
    }

    let files = (leadData || []).map(mapLeadFile)

    // ── 2. Arquivos de company_media_library (pastas de sistema do catálogo) ─
    if (folder_id && folderMeta?.is_system_folder && folderMeta?.path && supabaseAdmin) {
      let catalogQuery = supabaseAdmin
        .from('company_media_library')
        .select('*')
        .eq('company_id', company_id)
        .eq('folder_path', folderMeta.path)

      if (file_type && ['image', 'video', 'audio', 'document'].includes(file_type)) {
        catalogQuery = catalogQuery.eq('file_type', file_type)
      }

      if (search && search.trim()) {
        catalogQuery = catalogQuery.ilike('original_filename', `%${search.trim()}%`)
      }

      catalogQuery = catalogQuery.order(orderColumn, { ascending: sort_order === 'asc' })

      const { data: catalogData, error: catalogError } = await catalogQuery

      if (catalogError) {
        console.warn('⚠️ Erro ao buscar company_media_library:', catalogError.message)
      } else {
        const catalogFiles = (catalogData || []).map(file => ({
          id: file.id,
          original_filename: file.original_filename,
          file_type: file.file_type,
          mime_type: file.mime_type,
          file_size: file.file_size,
          s3_key: file.s3_key,
          thumbnail_s3_key: file.thumbnail_s3_key || null,
          preview_url: file.preview_url || null,
          received_at: file.created_at,
          source_message_id: null,
          created_at: file.created_at,
          folder_id: folder_id, // UUID da pasta de sistema para compatibilidade com filtro frontend
          folder_path: folderMeta.path,
          uploaded_by: null,
          tags: file.tags || [],
          is_favorite: false
        }))
        files = [...files, ...catalogFiles]
      }

      console.log('✅ Pasta de sistema: lead_media_unified +', (files.length - (leadData || []).length), 'arquivos do catálogo')
    }

    const totalCount = files.length
    const totalPages = Math.ceil(totalCount / limitNum)
    const hasNextPage = pageNum < totalPages
    const hasPrevPage = pageNum > 1

    // Paginação manual quando há merge das duas fontes
    const paginatedFiles = folder_id
      ? files.slice(offset, offset + limitNum)
      : files

    console.log('✅ Arquivos obtidos:', paginatedFiles.length, '| total:', totalCount)

    return res.status(200).json({
      success: true,
      data: {
        files: paginatedFiles,
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
