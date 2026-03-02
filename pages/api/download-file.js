// =====================================================
// API DE DOWNLOAD SEGURO DE ARQUIVOS
// =====================================================
// Data: 2026-02-21 - DOWNLOAD SEM EXPOR URL AWS
// Valida permissões e retorna arquivo via proxy

const { createClient } = require('@supabase/supabase-js')

// Cliente Supabase
const supabaseUrl = 'https://etzdsywunlpbgxkphuil.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0emRzeXd1bmxwYmd4a3BodWlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxOTIzMDMsImV4cCI6MjA2Mzc2ODMwM30.Y_h7mr36VPO1yX_rYB4IvY2C3oFodQsl-ncr0_kVO8E'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { fileId, companyId } = req.query

    // Validações
    if (!fileId || !companyId) {
      return res.status(400).json({ error: 'fileId e companyId são obrigatórios' })
    }

    console.log('📥 Download solicitado:', { fileId, companyId })

    // Buscar arquivo do banco com validação de company_id
    const { data: message, error } = await supabase
      .from('chat_messages')
      .select('id, media_url, message_type, content, company_id')
      .eq('id', fileId)
      .eq('company_id', companyId)
      .single()

    if (error || !message) {
      console.error('❌ Arquivo não encontrado:', error)
      return res.status(404).json({ error: 'Arquivo não encontrado' })
    }

    // Validação de segurança: company_id deve bater
    if (message.company_id !== companyId) {
      console.error('🚫 Tentativa de acesso não autorizado')
      return res.status(403).json({ error: 'Acesso não autorizado' })
    }

    if (!message.media_url) {
      return res.status(404).json({ error: 'Arquivo sem URL de mídia' })
    }

    console.log('✅ Arquivo autorizado, fazendo download da AWS...')

    // Fetch do arquivo da AWS S3 (server-side)
    const response = await fetch(message.media_url)
    
    if (!response.ok) {
      console.error('❌ Erro ao buscar arquivo da AWS:', response.status)
      return res.status(500).json({ error: 'Erro ao buscar arquivo' })
    }

    const buffer = await response.arrayBuffer()
    
    // Determinar tipo MIME
    const mimeTypes = {
      'image': 'image/jpeg',
      'video': 'video/mp4',
      'audio': 'audio/mpeg',
      'document': 'application/pdf'
    }
    const mimeType = mimeTypes[message.message_type] || 'application/octet-stream'

    // Gerar nome do arquivo
    const extension = {
      'image': 'jpg',
      'video': 'mp4',
      'audio': 'mp3',
      'document': 'pdf'
    }[message.message_type] || 'bin'
    
    const filename = message.content || `arquivo_${fileId}.${extension}`

    console.log('✅ Download concluído, enviando para cliente:', filename)

    // Retornar arquivo com headers corretos
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Length', buffer.byteLength)
    
    return res.send(Buffer.from(buffer))

  } catch (error) {
    console.error('❌ Erro no download:', error)
    return res.status(500).json({ error: 'Erro ao processar download' })
  }
}
