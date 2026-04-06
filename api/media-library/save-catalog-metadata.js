// Endpoint específico para salvar metadados do upload do catálogo
// (produtos/serviços) em company_media_library.
// NÃO altera o fluxo existente de leads.

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Use POST' })
    return
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
    } = req.body

    if (!company_id || !original_filename || !file_type || !mime_type || !file_size || !s3_key) {
      res.status(400).json({
        success: false,
        error: 'Campos obrigatórios: company_id, original_filename, file_type, mime_type, file_size, s3_key',
      })
      return
    }

    if (!['image', 'video'].includes(file_type)) {
      res.status(400).json({
        success: false,
        error: 'Catálogo aceita apenas imagens e vídeos.',
      })
      return
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co'
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseServiceKey) {
      res.status(500).json({
        success: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel',
      })
      return
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await supabase
      .from('company_media_library')
      .insert({
        company_id,
        original_filename,
        file_type,
        mime_type,
        file_size,
        s3_key,
        preview_url: preview_url || null,
      })
      .select('id, s3_key, file_type, original_filename, preview_url, company_id')
      .single()

    if (error) {
      res.status(500).json({ success: false, error: error.message, details: error })
      return
    }

    res.status(200).json({ success: true, data })
  } catch (error) {
    res.status(500).json({ success: false, error: error.message })
  }
}
