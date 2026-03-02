// =====================================================
// API PARA SALVAR METADADOS DA BIBLIOTECA
// =====================================================
// Endpoint: /api/media-library/save-metadata
// Método: POST
// Usa service role key para bypassar RLS
// Data: 2026-02-24 08:57

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // CORS headers
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
    console.log('📥 API save-metadata: Recebendo requisição')
    
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
    if (!company_id || !original_filename || !file_type || !mime_type || !file_size || !s3_key) {
      console.error('❌ Campos obrigatórios faltando')
      res.status(400).json({ 
        success: false, 
        error: 'Campos obrigatórios: company_id, original_filename, file_type, mime_type, file_size, s3_key' 
      })
      return
    }

    console.log('✅ Validação OK:', {
      company_id,
      filename: original_filename,
      file_type,
      s3_key: s3_key.substring(0, 50) + '...'
    })

    // Criar cliente Supabase com SERVICE ROLE KEY
    // Usar variáveis de ambiente existentes no Vercel
    const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://etzdsywunlpbgxkphuil.supabase.co'
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    
    if (!supabaseServiceKey) {
      console.error('❌ SUPABASE_SERVICE_ROLE_KEY não configurada')
      console.error('⚠️ Adicione esta variável no Vercel: Settings → Environment Variables')
      res.status(500).json({ 
        success: false, 
        error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel' 
      })
      return
    }

    console.log('🔑 Usando service role key para bypassar RLS')
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Inserir metadados no banco
    console.log('💾 Inserindo metadados no banco...')
    
    const fileRecord = {
      company_id,
      original_filename,
      file_type,
      mime_type,
      file_size,
      s3_key,
      preview_url: preview_url || null,
      folder_id: folder_id || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('lead_media_unified')
      .insert([fileRecord])
      .select()
      .single()

    if (error) {
      console.error('❌ Erro ao inserir no banco:', error)
      res.status(500).json({ 
        success: false, 
        error: error.message,
        details: error
      })
      return
    }

    console.log('✅ Metadados salvos com sucesso! ID:', data.id)
    
    res.status(200).json({ 
      success: true, 
      data: {
        id: data.id,
        s3_key: data.s3_key,
        folder_id: data.folder_id
      }
    })

  } catch (error) {
    console.error('❌ Erro na API save-metadata:', error)
    res.status(500).json({ 
      success: false, 
      error: error.message 
    })
  }
}
