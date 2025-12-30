// API S3 Direta para Pasta Chat
import { createClient } from '@supabase/supabase-js'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function detectFileType(filename) {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image'
  if (['mp4', 'avi', 'mov', 'webm'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg'].includes(ext)) return 'audio'
  return 'document'
}

async function getCredentials(companyId) {
  const { data } = await supabase
    .from('aws_credentials')
    .select('*')
    .eq('company_id', companyId)
    .single()
  
  return data || {
    access_key_id: process.env.AWS_ACCESS_KEY_ID,
    secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'sa-east-1',
    bucket: 'aws-lovoocrm-media'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { company_id, prefix, page = '1', limit = '50' } = req.body

    console.log('🔍 S3 API Direta:', { company_id, prefix })

    const credentials = await getCredentials(company_id)
    
    const s3Client = new S3Client({
      region: credentials.region,
      credentials: {
        accessKeyId: credentials.access_key_id,
        secretAccessKey: credentials.secret_access_key,
      },
    })

    const command = new ListObjectsV2Command({
      Bucket: credentials.bucket,
      Prefix: prefix,
      MaxKeys: 1000
    })

    const response = await s3Client.send(command)
    
    if (!response.Contents) {
      return res.json({ files: [], pagination: {}, stats: {} })
    }

    const files = response.Contents
      .filter(obj => obj.Key && obj.Key !== prefix)
      .filter(obj => {
        const filename = obj.Key.split('/').pop()
        const ext = filename?.split('.').pop()?.toLowerCase()
        return ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'avi', 'mov', 'mp3', 'wav', 'pdf'].includes(ext)
      })
      .map(obj => {
        const filename = obj.Key.split('/').pop()
        const fileType = detectFileType(filename)
        
        return {
          id: `s3_${obj.Key.replace(/[^a-zA-Z0-9]/g, '_')}`,
          s3_key: obj.Key,
          original_filename: filename,
          file_type: fileType,
          mime_type: `${fileType}/${filename.split('.').pop()}`,
          file_size: obj.Size || 0,
          preview_url: `https://${credentials.bucket}.s3.${credentials.region}.amazonaws.com/${obj.Key}`,
          received_at: obj.LastModified?.toISOString() || new Date().toISOString(),
          created_at: obj.LastModified?.toISOString() || new Date().toISOString(),
          source: 'whatsapp_s3_real'
        }
      })

    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const offset = (pageNum - 1) * limitNum
    const paginatedFiles = files.slice(offset, offset + limitNum)
    
    const stats = files.reduce((acc, file) => {
      acc[file.file_type] = (acc[file.file_type] || 0) + 1
      acc.total = (acc.total || 0) + 1
      return acc
    }, {})

    console.log('✅ S3 Arquivos encontrados:', files.length)

    return res.json({
      files: paginatedFiles,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: files.length,
        totalPages: Math.ceil(files.length / limitNum),
        hasNext: offset + limitNum < files.length,
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
    console.error('❌ Erro S3 API:', error)
    return res.status(500).json({ error: 'Erro ao listar arquivos S3' })
  }
}
