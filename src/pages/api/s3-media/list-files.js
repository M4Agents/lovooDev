// =====================================================
// API S3 LIST FILES - UNIFICADA
// =====================================================
// MODIFICADA: 2026-02-21 08:42
// Pasta Chat: busca de chat_messages (WhatsApp)
// Outras pastas: busca de company_media_library (uploads)
// Segurança multi-tenant garantida

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

export default async function handler(req, res) {
  console.log('🔥🔥🔥 S3 LIST FILES - UNIFICADA - 2026-02-21 09:00 🔥🔥🔥')
  console.log('📊 Método:', req.method)
  
  // Aceitar GET e POST para compatibilidade
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    // Suportar parâmetros de GET (query) e POST (body)
    const params = req.method === 'POST' ? req.body : req.query
    const { company_id, folder_id, page = '1', limit = '50', action } = params
    
    console.log('📊 Parâmetros recebidos:', { company_id, folder_id, page, limit, action })
    
    // VALIDAÇÃO: company_id obrigatório
    if (!company_id) {
      console.error('❌ company_id não fornecido')
      return res.status(400).json({ error: 'company_id obrigatório' })
    }
    
    // AÇÃO ESPECIAL: Listar pastas
    if (action === 'LIST_FOLDERS') {
      console.log('📁 Listando pastas da empresa:', company_id)
      
      const { data: folders, error } = await supabase
        .from('company_folders')
        .select('*')
        .eq('company_id', company_id)
        .order('name')
      
      if (error) {
        console.error('❌ Erro ao buscar pastas:', error)
        return res.status(500).json({ error: 'Erro ao buscar pastas' })
      }
      
      console.log('✅ Pastas encontradas:', folders?.length || 0)
      
      return res.json({
        success: true,
        folders: folders || [],
        action: 'LIST_FOLDERS'
      })
    }
    
    let files = []
    
    // VERIFICAR SE É PASTA CHAT
    const { data: folder } = await supabase
      .from('company_folders')
      .select('id, name, path')
      .eq('id', folder_id)
      .eq('company_id', company_id)
      .single()
    
    const isChatFolder = folder?.name === 'Chat' || folder?.path === '/chat'
    
    if (isChatFolder) {
      console.log('💬 PASTA CHAT DETECTADA - Buscando de chat_messages')
      
      // BUSCAR DE chat_messages (WhatsApp)
      const { data: messages, error } = await supabase
        .from('chat_messages')
        .select('id, media_url, message_type, content, created_at, company_id')
        .eq('company_id', company_id)
        .in('message_type', ['image', 'video', 'audio', 'document'])
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit))
      
      if (error) {
        console.error('❌ Erro ao buscar chat_messages:', error)
        return res.status(500).json({ error: 'Erro ao buscar arquivos' })
      }
      
      console.log('✅ Mensagens WhatsApp encontradas:', messages?.length || 0)
      
      files = (messages || []).map(msg => {
        const s3Key = msg.media_url?.replace('https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/', '') || ''
        const filename = s3Key.split('/').pop() || msg.content || 'arquivo'
        
        return {
          id: msg.id,
          s3_key: s3Key,
          original_filename: filename,
          file_type: msg.message_type,
          mime_type: `${msg.message_type}/unknown`,
          file_size: 0,
          preview_url: msg.media_url,
          received_at: msg.created_at,
          created_at: msg.created_at,
          company_id: msg.company_id,
          source: 'whatsapp_chat'
        }
      })
    } else {
      console.log('📁 PASTA NORMAL DETECTADA - Buscando de company_media_library')
      
      // BUSCAR DE company_media_library (uploads)
      const { data: mediaFiles, error } = await supabase
        .from('company_media_library')
        .select('*')
        .eq('company_id', company_id)
        .eq('folder_id', folder_id)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit))
      
      if (error) {
        console.error('❌ Erro ao buscar company_media_library:', error)
        return res.status(500).json({ error: 'Erro ao buscar arquivos' })
      }
      
      console.log('✅ Arquivos da pasta encontrados:', mediaFiles?.length || 0)
      
      files = (mediaFiles || []).map(file => ({
        id: file.id,
        s3_key: file.s3_key,
        original_filename: file.original_filename,
        file_type: file.file_type,
        mime_type: file.mime_type,
        file_size: file.file_size,
        preview_url: file.preview_url,
        created_at: file.created_at,
        company_id: file.company_id,
        folder_id: file.folder_id,
        source: 'company_library'
      }))
    }
    
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    
    const stats = files.reduce((acc, file) => {
      acc[file.file_type] = (acc[file.file_type] || 0) + 1
      acc.total = (acc.total || 0) + 1
      return acc
    }, {})
    
    console.log('✅ Total de arquivos retornados:', files.length)
    console.log('📊 Estatísticas:', stats)
    
    return res.json({
      files,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: files.length,
        totalPages: Math.ceil(files.length / limitNum),
        hasNext: false,
        hasPrev: pageNum > 1
      },
      stats: {
        total: stats.total || 0,
        image: stats.image || 0,
        video: stats.video || 0,
        audio: stats.audio || 0,
        document: stats.document || 0
      }
    })

  } catch (error) {
    console.error('❌ Erro na API:', error)
    return res.status(500).json({ 
      error: 'Erro ao buscar arquivos',
      message: error.message 
    })
  }
}
