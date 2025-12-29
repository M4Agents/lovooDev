// =====================================================
// S3 PRESIGNED URLs - GERAÇÃO SEGURA DE URLs
// =====================================================
// Utilitário para gerar presigned URLs do AWS S3

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
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

/**
 * Gerar presigned URL para acesso temporário ao arquivo S3
 */
export async function generatePresignedUrl(s3Key, expiresIn = 3600) {
  try {
    console.log('🔗 Gerando presigned URL:', { s3Key, expiresIn })

    // Limpar chave S3 se tiver prefixo incorreto
    let cleanKey = s3Key
    if (cleanKey.startsWith('supabase/')) {
      cleanKey = cleanKey.replace('supabase/', '')
    }

    // Comando para obter objeto
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: cleanKey
    })

    // Gerar presigned URL
    const presignedUrl = await getSignedUrl(s3Client, command, { 
      expiresIn // Tempo de expiração em segundos (padrão: 1 hora)
    })

    console.log('✅ Presigned URL gerada:', {
      bucket: S3_BUCKET,
      key: cleanKey.substring(0, 50) + '...',
      expiresIn,
      url: presignedUrl.substring(0, 100) + '...'
    })

    return presignedUrl

  } catch (error) {
    console.error('❌ Erro ao gerar presigned URL:', error)
    throw new Error(`Erro ao gerar URL de acesso: ${error.message}`)
  }
}

/**
 * Gerar múltiplas presigned URLs em lote
 */
export async function generateMultiplePresignedUrls(s3Keys, expiresIn = 3600) {
  try {
    console.log('🔗 Gerando múltiplas presigned URLs:', s3Keys.length, 'arquivos')

    const promises = s3Keys.map(s3Key => 
      generatePresignedUrl(s3Key, expiresIn).catch(error => {
        console.error('❌ Erro em arquivo específico:', s3Key, error.message)
        return null // Retorna null para arquivos com erro
      })
    )

    const results = await Promise.all(promises)
    
    const successful = results.filter(url => url !== null)
    console.log('✅ Presigned URLs geradas:', successful.length, 'de', s3Keys.length)

    return results

  } catch (error) {
    console.error('❌ Erro ao gerar múltiplas presigned URLs:', error)
    throw error
  }
}

/**
 * Verificar se arquivo existe no S3
 */
export async function checkFileExists(s3Key) {
  try {
    // Limpar chave S3
    let cleanKey = s3Key
    if (cleanKey.startsWith('supabase/')) {
      cleanKey = cleanKey.replace('supabase/', '')
    }

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: cleanKey
    })

    // Tentar gerar presigned URL - se funcionar, arquivo existe
    await getSignedUrl(s3Client, command, { expiresIn: 60 })
    return true

  } catch (error) {
    console.log('⚠️ Arquivo não encontrado no S3:', s3Key)
    return false
  }
}

export default {
  generatePresignedUrl,
  generateMultiplePresignedUrls,
  checkFileExists
}
