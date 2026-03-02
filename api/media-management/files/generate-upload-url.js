// =====================================================
// GENERATE UPLOAD URL - PRESIGNED URL PARA UPLOAD DIRETO
// =====================================================
// API para gerar presigned URL permitindo upload direto do frontend para AWS S3
// Contorna limite de 4.5MB do Vercel

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Configuração AWS
const AWS_REGION = process.env.AWS_REGION || 'sa-east-1'
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY
const S3_BUCKET = process.env.AWS_S3_BUCKET || 'aws-lovoocrm-media'

// Validar configuração
if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
  console.error('❌ Credenciais AWS não configuradas')
}

// Cliente S3
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY
  }
})

// Configuração do Next.js para aceitar JSON
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Aumentar limite para JSON
    },
  },
}

export default async function handler(req, res) {
  // Aceitar GET (query params) para evitar limite de body do Vercel
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas GET é permitido neste endpoint'
    })
  }

  try {
    const { company_id, filename, content_type } = req.query

    console.log('🔗 Gerando presigned URL para upload:', { 
      company_id, 
      filename, 
      content_type
    })

    // Validações
    if (!company_id || !filename || !content_type) {
      return res.status(400).json({
        error: 'Parâmetros obrigatórios',
        message: 'company_id, filename e content_type são necessários'
      })
    }

    // Gerar estrutura de pastas (mesma do upload atual)
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    
    // Gerar nome único para o arquivo
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(7)
    const fileExt = filename.split('.').pop()
    const uniqueFilename = `${timestamp}_${randomStr}.${fileExt}`
    
    // Gerar s3_key (mesma estrutura da biblioteca)
    const s3Key = `biblioteca/companies/${company_id}/${year}/${month}/${day}/${uniqueFilename}`

    console.log('📁 S3 Key gerado:', s3Key)

    // Comando para upload (PUT)
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      ContentType: content_type,
      // Metadata para rastreamento
      Metadata: {
        'original-filename': filename,
        'company-id': company_id,
        'upload-source': 'biblioteca-direct'
      }
    })

    // Gerar presigned URL (válida por 15 minutos)
    const presignedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn: 900 // 15 minutos
    })

    console.log('✅ Presigned URL gerada com sucesso')

    return res.status(200).json({
      success: true,
      data: {
        upload_url: presignedUrl,
        s3_key: s3Key,
        original_filename: filename,
        expires_in: 900
      }
    })

  } catch (error) {
    console.error('❌ Erro ao gerar presigned URL:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao gerar URL de upload',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
