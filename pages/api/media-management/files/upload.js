// =====================================================
// MEDIA MANAGEMENT - UPLOAD DE ARQUIVO REAL AWS S3
// =====================================================
// API para upload de arquivos usando infraestrutura do chat funcionando

import { createClient } from '@supabase/supabase-js'
import formidable from 'formidable'
import fs from 'fs'

// Configuração do Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export const config = {
  api: {
    bodyParser: false, // Necessário para formidable
  },
}

export default async function handler(req, res) {
  // Apenas POST permitido
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas POST é permitido neste endpoint'
    })
  }

  try {
    console.log('📤 Iniciando upload real AWS S3 para biblioteca')

    // Parse do form-data usando formidable
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024, // 50MB
      keepExtensions: true,
    })

    const [fields, files] = await form.parse(req)
    
    // Extrair dados do form
    const company_id = fields.company_id?.[0]
    const folder_id = fields.folder_id?.[0] || null
    
    // Validações básicas
    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    // Verificar se há arquivo
    const uploadedFile = files.file?.[0]
    if (!uploadedFile) {
      return res.status(400).json({
        error: 'Arquivo obrigatório',
        message: 'Nenhum arquivo foi enviado'
      })
    }

    console.log('📁 Arquivo recebido:', {
      filename: uploadedFile.originalFilename,
      size: uploadedFile.size,
      mimetype: uploadedFile.mimetype,
      company_id
    })

    // Ler arquivo como buffer
    const fileBuffer = fs.readFileSync(uploadedFile.filepath)
    
    // Importar S3Storage dinamicamente (usando infraestrutura do chat)
    const { S3Storage } = await import('../../../../src/services/aws/s3Storage')

    // Detectar content type
    const contentType = S3Storage.detectContentType(fileBuffer, uploadedFile.originalFilename)
    console.log('🔍 Content type detectado:', contentType)

    // Gerar ID único para o arquivo
    const messageId = `biblioteca-${company_id}-${Date.now()}`
    
    // Gerar data atual para estrutura de pastas
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')

    console.log('🚀 Iniciando upload para AWS S3...')

    // Upload para S3 usando infraestrutura do chat
    const uploadResult = await S3Storage.uploadToS3({
      companyId: company_id,
      messageId: messageId,
      originalFileName: uploadedFile.originalFilename,
      buffer: fileBuffer,
      contentType: contentType,
      source: 'biblioteca',
      customPath: `biblioteca/companies/${company_id}/${year}/${month}/${day}` // Estrutura específica da biblioteca
    })

    if (!uploadResult.success || !uploadResult.data) {
      console.error('❌ Falha no upload S3:', uploadResult.error)
      return res.status(500).json({
        error: 'Falha no upload S3',
        message: uploadResult.error || 'Erro desconhecido no S3'
      })
    }

    console.log('✅ Upload S3 bem-sucedido:', uploadResult.data)

    // Gerar URL de preview usando endpoint proxy
    const previewUrl = `/api/s3-media/${encodeURIComponent(uploadedFile.originalFilename)}`

    // Salvar metadados no banco lead_media_unified
    const fileRecord = {
      id: `lib_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      company_id: company_id,
      original_filename: uploadedFile.originalFilename,
      file_type: contentType.startsWith('image/') ? 'image' : 
                 contentType.startsWith('video/') ? 'video' :
                 contentType.startsWith('audio/') ? 'audio' : 'document',
      mime_type: contentType,
      file_size: uploadedFile.size,
      s3_key: uploadResult.data.s3Key,
      preview_url: previewUrl,
      folder_id: folder_id,
      source: 'biblioteca',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    // Inserir no banco
    const { data: insertData, error: insertError } = await supabase
      .from('lead_media_unified')
      .insert([fileRecord])
      .select()
      .single()

    if (insertError) {
      console.error('❌ Erro ao salvar no banco:', insertError)
      return res.status(500).json({
        error: 'Erro ao salvar metadados',
        message: insertError.message
      })
    }

    console.log('✅ Upload completo - arquivo salvo no S3 e metadados no banco')

    // Limpar arquivo temporário
    fs.unlinkSync(uploadedFile.filepath)

    return res.status(200).json({
      success: true,
      data: insertData
    })

  } catch (error) {
    console.error('❌ Erro na API de upload:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao fazer upload',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
