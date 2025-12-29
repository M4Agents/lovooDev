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
    
    console.log('📋 Dados recebidos:', { fields, files: Object.keys(files) })
    
    // Extrair dados do form
    const company_id = fields.company_id?.[0]
    const folder_id = fields.folder_id?.[0] || null
    
    console.log('🔍 Parâmetros extraídos:', { company_id, folder_id })
    
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

    // UPLOAD REAL PARA AWS S3 usando credenciais do banco
    console.log('🚀 Iniciando upload REAL para AWS S3...')
    
    // Ler arquivo como buffer
    const fileBuffer = fs.readFileSync(uploadedFile.filepath)
    
    try {
      console.log('🔑 Buscando credenciais AWS no banco...')
      
      // Buscar credenciais AWS da empresa no banco
      const { data: awsCredentials, error: credError } = await supabase
        .from('aws_credentials')
        .select('access_key_id, secret_access_key, region, bucket')
        .eq('company_id', company_id)
        .single()
      
      if (credError || !awsCredentials) {
        console.error('❌ Credenciais AWS não encontradas:', credError)
        throw new Error('Credenciais AWS não configuradas para esta empresa')
      }
      
      console.log('✅ Credenciais AWS encontradas:', { 
        bucket: awsCredentials.bucket, 
        region: awsCredentials.region 
      })
      
      // Importar AWS SDK v3
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
      
      // Configurar cliente S3
      const s3Client = new S3Client({
        region: awsCredentials.region,
        credentials: {
          accessKeyId: awsCredentials.access_key_id,
          secretAccessKey: awsCredentials.secret_access_key
        }
      })
      
      // Gerar chave S3 seguindo padrão do chat
      const messageId = `biblioteca-${company_id}-${Date.now()}`
      const now = new Date()
      const year = now.getFullYear()
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const day = String(now.getDate()).padStart(2, '0')
      
      const s3Key = `biblioteca/companies/${company_id}/${year}/${month}/${day}/${messageId}/${uploadedFile.originalFilename}`
      
      console.log('📤 Fazendo upload REAL para S3:', { 
        bucket: awsCredentials.bucket, 
        key: s3Key,
        size: fileBuffer.length 
      })
      
      // Comando de upload para S3
      const uploadCommand = new PutObjectCommand({
        Bucket: awsCredentials.bucket,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: uploadedFile.mimetype,
        ContentLength: fileBuffer.length
      })
      
      // Executar upload real para S3
      const uploadResult = await s3Client.send(uploadCommand)
      
      console.log('✅ Upload REAL para S3 bem-sucedido:', { 
        s3Key, 
        messageId, 
        etag: uploadResult.ETag 
      })

      // Gerar URL de preview usando endpoint proxy (como chat faz)
      const previewUrl = `/api/s3-media/${encodeURIComponent(uploadedFile.originalFilename)}`

      // Salvar metadados no banco lead_media_unified (sem ID - deixar PostgreSQL gerar UUID)
      const fileRecord = {
        company_id: company_id,
        original_filename: uploadedFile.originalFilename,
        file_type: uploadedFile.mimetype.startsWith('image/') ? 'image' : 
                   uploadedFile.mimetype.startsWith('video/') ? 'video' :
                   uploadedFile.mimetype.startsWith('audio/') ? 'audio' : 'document',
        mime_type: uploadedFile.mimetype,
        file_size: uploadedFile.size,
        s3_key: s3Key,
        preview_url: previewUrl
      }
      
      console.log('💾 Salvando no banco:', fileRecord)

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

      console.log('✅ Upload completo - arquivo salvo e metadados no banco')

      // Limpar arquivo temporário
      fs.unlinkSync(uploadedFile.filepath)

      return res.status(200).json({
        success: true,
        data: insertData
      })

    } catch (uploadError) {
      console.error('❌ Erro no upload:', uploadError)
      return res.status(500).json({
        error: 'Erro no upload',
        message: uploadError.message
      })
    }

  } catch (error) {
    console.error('❌ Erro na API de upload:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao fazer upload',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
