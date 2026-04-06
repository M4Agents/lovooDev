// =====================================================
// SAVE S3 METADATA - API
// =====================================================
// Salva metadados de arquivo já uploadado para S3
// Usado pelo DirectS3Upload após upload direto
// Data: 2026-02-22 12:24

import formidable from 'formidable'
import { createClient } from '@supabase/supabase-js'

// Usar configuração hardcoded do projeto (mesma do src/lib/supabase.ts)
const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E'

export const config = {
  api: {
    bodyParser: false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Parse form data
    const form = formidable()
    const [fields] = await form.parse(req)

    const company_id = fields.company_id?.[0]
    const original_filename = fields.original_filename?.[0]
    const mime_type = fields.mime_type?.[0]
    const file_size = parseInt(fields.file_size?.[0] || '0')
    const s3_key = fields.s3_key?.[0]
    const preview_url = fields.preview_url?.[0]
    const folder_id = fields.folder_id?.[0] || null

    console.log('💾 Salvando metadados S3:', {
      company_id,
      original_filename,
      s3_key,
      folder_id
    })

    // Validações
    if (!company_id || !original_filename || !s3_key) {
      return res.status(400).json({
        error: 'Parâmetros obrigatórios faltando',
        message: 'company_id, original_filename e s3_key são necessários'
      })
    }

    // Detectar tipo de arquivo
    let file_type = 'document'
    if (mime_type?.startsWith('image/')) file_type = 'image'
    else if (mime_type?.startsWith('video/')) file_type = 'video'
    else if (mime_type?.startsWith('audio/')) file_type = 'audio'

    // Usar service role key para bypassar RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Bloquear upload direto em pastas de sistema
    if (folder_id) {
      const { data: folder } = await supabase
        .from('company_folders')
        .select('is_system_folder')
        .eq('id', folder_id)
        .eq('company_id', company_id)
        .single()

      if (folder?.is_system_folder) {
        return res.status(403).json({
          error: 'Pasta protegida',
          message: 'Esta pasta é gerenciada pelo catálogo. Use a gestão de produtos ou serviços para adicionar mídias aqui.'
        })
      }
    }

    // Inserir metadados
    const { data, error } = await supabase
      .from('lead_media_unified')
      .insert([{
        company_id,
        original_filename,
        file_type,
        mime_type,
        file_size,
        s3_key,
        preview_url,
        folder_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single()

    if (error) {
      console.error('❌ Erro ao inserir metadados:', error)
      return res.status(500).json({
        error: 'Erro ao salvar metadados',
        message: error.message
      })
    }

    console.log('✅ Metadados salvos com sucesso:', data.id)

    return res.status(200).json({
      success: true,
      data
    })

  } catch (error) {
    console.error('❌ Erro no save-s3-metadata:', error)
    return res.status(500).json({
      error: 'Erro interno',
      message: error.message
    })
  }
}
