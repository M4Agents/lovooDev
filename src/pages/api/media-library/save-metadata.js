// =====================================================
// API: SAVE METADATA - Salvar metadados após upload S3
// Data: 17/03/2026
// Objetivo: Salvar metadados de arquivo após upload direto S3
// =====================================================

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    })
  }

  try {
    const {
      company_id,
      original_filename,
      file_type,
      mime_type,
      file_size,
      s3_key,
      preview_url,
      folder_id
    } = req.body

    // Validações
    if (!company_id || !original_filename || !file_type || !s3_key || !preview_url) {
      return res.status(400).json({
        success: false,
        error: 'Campos obrigatórios faltando'
      })
    }

    // Inicializar Supabase com service role (bypassa RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Gerar ID único
    const fileId = `lib_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    // Preparar dados
    const fileRecord = {
      id: fileId,
      company_id: company_id,
      original_filename: original_filename,
      file_type: file_type,
      mime_type: mime_type || 'application/octet-stream',
      file_size: file_size || 0,
      s3_key: s3_key,
      preview_url: preview_url,
      folder_id: folder_id || null,
      source: 'biblioteca_s3_direct',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    console.log('💾 Salvando metadados:', {
      id: fileId,
      filename: original_filename,
      folder_id: folder_id
    })

    // Salvar no banco
    const { data, error } = await supabase
      .from('lead_media_unified')
      .insert([fileRecord])
      .select()
      .single()

    if (error) {
      console.error('❌ Erro ao salvar metadados:', error)
      return res.status(500).json({
        success: false,
        error: `Erro ao salvar metadados: ${error.message}`
      })
    }

    console.log('✅ Metadados salvos com sucesso:', data.id)

    return res.status(200).json({
      success: true,
      data: data
    })

  } catch (error) {
    console.error('❌ Erro no save-metadata:', error)
    return res.status(500).json({
      success: false,
      error: error.message || 'Erro interno do servidor'
    })
  }
}
