// =====================================================
// API: LISTAR ARQUIVOS DA EMPRESA
// =====================================================
// Endpoint para obter lista de arquivos de mídia da empresa
// Especificamente para pasta Chat - lista arquivos S3 do WhatsApp

import { createClient } from '@supabase/supabase-js'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

// =====================================================
// CONFIGURAÇÃO SUPABASE
// =====================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// =====================================================
// FUNÇÕES AUXILIARES
// =====================================================

// Detectar tipo de arquivo baseado na extensão
function detectFileType(filename) {
  const extension = filename.split('.').pop()?.toLowerCase()
  
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) {
    return 'image'
  }
  if (['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'].includes(extension)) {
    return 'video'
  }
  if (['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(extension)) {
    return 'audio'
  }
  return 'document'
}

// Gerar URL de preview do S3
function generatePreviewUrl(s3Key, region = 'sa-east-1', bucket = 'aws-lovoocrm-media') {
  return `https://${bucket}.s3.${region}.amazonaws.com/${s3Key}`
}

// Obter credenciais AWS da empresa
async function getCompanyAwsCredentials(companyId) {
  try {
    const { data, error } = await supabase
      .from('aws_credentials')
      .select('access_key_id, secret_access_key, region, bucket')
      .eq('company_id', companyId)
      .single()

    if (error) {
      console.log('⚠️ Credenciais AWS não encontradas, usando padrão')
      return {
        access_key_id: process.env.AWS_ACCESS_KEY_ID,
        secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
        region: 'sa-east-1',
        bucket: 'aws-lovoocrm-media'
      }
    }

    return data
  } catch (error) {
    console.log('⚠️ Erro ao buscar credenciais AWS, usando padrão:', error.message)
    return {
      access_key_id: process.env.AWS_ACCESS_KEY_ID,
      secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
      region: 'sa-east-1',
      bucket: 'aws-lovoocrm-media'
    }
  }
}

// Listar arquivos S3 reais da pasta Chat
async function listS3ChatFiles(companyId, credentials) {
  try {
    // Configurar cliente S3
    const s3Client = new S3Client({
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
      },
    })

    // Definir prefixo para arquivos de chat da empresa - buscar em toda pasta clientes
    const prefix = `clientes/${companyId}/`
    
    console.log('🔍 Listando arquivos S3 reais da pasta clientes:', {
      bucket: credentials.bucket,
      prefix,
      companyId
    })

    // Listar objetos do S3
    const command = new ListObjectsV2Command({
      Bucket: credentials.bucket,
      Prefix: prefix,
      MaxKeys: 1000 // Limitar para evitar timeout
    })

    const response = await s3Client.send(command)
    
    if (!response.Contents || response.Contents.length === 0) {
      console.log('📁 Nenhum arquivo encontrado no S3 para:', prefix)
      return []
    }

    console.log('✅ Arquivos encontrados no S3:', response.Contents.length)

    // Processar arquivos encontrados - filtrar apenas arquivos de mídia
    const files = response.Contents
      .filter(obj => {
        if (!obj.Key || obj.Key === prefix) return false
        const filename = obj.Key.split('/').pop()
        if (!filename || filename.length === 0) return false
        
        // Filtrar apenas arquivos de mídia (imagens, vídeos, áudios, documentos)
        const extension = filename.split('.').pop()?.toLowerCase()
        const mediaExtensions = [
          'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg',
          'mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv',
          'mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac',
          'pdf', 'doc', 'docx', 'txt', 'rtf'
        ]
        
        return extension && mediaExtensions.includes(extension)
      })
      .map(obj => {
        const filename = obj.Key.split('/').pop()
        const fileType = detectFileType(filename)
        
        return {
          id: `s3_real_${obj.Key.replace(/[^a-zA-Z0-9]/g, '_')}`,
          s3_key: obj.Key,
          original_filename: filename,
          file_type: fileType,
          mime_type: getMimeType(filename),
          file_size: obj.Size || 0,
          preview_url: generatePreviewUrl(obj.Key, credentials.region, credentials.bucket),
          received_at: obj.LastModified?.toISOString() || new Date().toISOString(),
          created_at: obj.LastModified?.toISOString() || new Date().toISOString(),
          source: 'whatsapp_s3_real'
        }
      })

    console.log('✅ Arquivos de mídia processados:', files.length)
    return files

  } catch (error) {
    console.error('❌ Erro ao listar arquivos S3:', error)
    throw error
  }
}

// Função para obter MIME type correto
function getMimeType(filename) {
  const extension = filename.split('.').pop()?.toLowerCase()
  const mimeTypes = {
    // Imagens
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml',
    // Vídeos
    'mp4': 'video/mp4',
    'avi': 'video/x-msvideo',
    'mov': 'video/quicktime',
    'wmv': 'video/x-ms-wmv',
    'flv': 'video/x-flv',
    'webm': 'video/webm',
    'mkv': 'video/x-matroska',
    // Áudios
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'ogg': 'audio/ogg',
    'aac': 'audio/aac',
    'm4a': 'audio/mp4',
    'flac': 'audio/flac',
    // Documentos
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain',
    'rtf': 'application/rtf'
  }
  
  return mimeTypes[extension] || 'application/octet-stream'
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { company_id, folder_id, page = 1, limit = 50, search, file_type } = req.query

    if (!company_id) {
      return res.status(400).json({ error: 'company_id é obrigatório' })
    }

    console.log('🏢 API Company Files chamada:', {
      company_id,
      folder_id,
      page,
      limit,
      search,
      file_type
    })

    // Verificar se é pasta Chat
    let isChatFolder = false
    if (folder_id) {
      const { data: folderData } = await supabase
        .from('company_folders')
        .select('name, path')
        .eq('id', folder_id)
        .eq('company_id', company_id)
        .single()

      if (folderData && (folderData.name === 'Chat' || folderData.path === '/chat')) {
        isChatFolder = true
        console.log('💬 PASTA CHAT DETECTADA - Listando arquivos S3')
      }
    }

    if (!isChatFolder) {
      return res.status(400).json({ 
        error: 'Esta API é específica para a pasta Chat',
        message: 'Use a API de leads para outras pastas'
      })
    }

    // Obter credenciais AWS
    const credentials = await getCompanyAwsCredentials(company_id)
    
    // Listar arquivos S3
    const s3Files = await listS3ChatFiles(company_id, credentials)

    // Aplicar filtros
    let filteredFiles = s3Files

    if (file_type && ['image', 'video', 'audio', 'document'].includes(file_type)) {
      filteredFiles = filteredFiles.filter(file => file.file_type === file_type)
    }

    if (search && search.trim()) {
      filteredFiles = filteredFiles.filter(file => 
        file.original_filename.toLowerCase().includes(search.trim().toLowerCase())
      )
    }

    // Aplicar paginação
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const offset = (pageNum - 1) * limitNum
    const paginatedFiles = filteredFiles.slice(offset, offset + limitNum)

    // Calcular estatísticas
    const stats = filteredFiles.reduce((acc, file) => {
      acc[file.file_type] = (acc[file.file_type] || 0) + 1
      acc.total = (acc.total || 0) + 1
      return acc
    }, {})

    console.log('✅ PASTA CHAT S3: Retornando', paginatedFiles.length, 'de', filteredFiles.length, 'arquivos')

    return res.status(200).json({
      files: paginatedFiles,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: filteredFiles.length,
        totalPages: Math.ceil(filteredFiles.length / limitNum),
        hasNext: offset + limitNum < filteredFiles.length,
        hasPrev: pageNum > 1
      },
      stats: {
        total: stats.total || 0,
        image: stats.image || 0,
        video: stats.video || 0,
        audio: stats.audio || 0,
        document: stats.document || 0
      },
      source: 'company_s3_chat'
    })

  } catch (error) {
    console.error('❌ Erro na API Company Files:', error)
    return res.status(500).json({
      error: 'Erro interno do servidor',
      details: error.message
    })
  }
}
