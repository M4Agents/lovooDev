// =====================================================
// MEDIA MANAGEMENT - DELETE DE ARQUIVO
// =====================================================
// API para deletar arquivos da biblioteca de mídias

import { createClient } from '@supabase/supabase-js'

// Configuração do Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(req, res) {
  // Apenas DELETE permitido
  if (req.method !== 'DELETE') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas DELETE é permitido neste endpoint'
    })
  }

  try {
    const { fileIds } = req.body
    const { company_id } = req.query

    console.log('🗑️ Iniciando delete de arquivos:', { fileIds, company_id })

    // Validações básicas
    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
      return res.status(400).json({
        error: 'IDs de arquivos obrigatórios',
        message: 'Parâmetro fileIds deve ser um array com pelo menos um ID'
      })
    }

    // Buscar arquivos para verificar se existem e obter s3_keys
    const { data: filesToDelete, error: fetchError } = await supabase
      .from('lead_media_unified')
      .select('id, s3_key, original_filename')
      .eq('company_id', company_id)
      .in('id', fileIds)

    if (fetchError) {
      console.error('❌ Erro ao buscar arquivos:', fetchError)
      return res.status(500).json({
        error: 'Erro ao buscar arquivos',
        message: fetchError.message
      })
    }

    if (!filesToDelete || filesToDelete.length === 0) {
      return res.status(404).json({
        error: 'Arquivos não encontrados',
        message: 'Nenhum arquivo encontrado com os IDs fornecidos'
      })
    }

    console.log('📁 Arquivos encontrados para delete:', filesToDelete.map(f => f.original_filename))

    // Deletar do AWS S3 (se necessário)
    try {
      console.log('🔑 Buscando credenciais AWS para delete...')
      
      const { data: awsCredentials, error: credError } = await supabase
        .from('aws_credentials')
        .select('access_key_id, secret_access_key, region, bucket')
        .eq('company_id', company_id)
        .single()

      if (awsCredentials && !credError) {
        console.log('🗑️ Deletando arquivos do S3...')
        
        // Importar AWS SDK v3
        const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
        
        // Configurar cliente S3
        const s3Client = new S3Client({
          region: awsCredentials.region,
          credentials: {
            accessKeyId: awsCredentials.access_key_id,
            secretAccessKey: awsCredentials.secret_access_key
          }
        })

        // Deletar cada arquivo do S3
        for (const file of filesToDelete) {
          try {
            const deleteCommand = new DeleteObjectCommand({
              Bucket: awsCredentials.bucket,
              Key: file.s3_key
            })
            
            await s3Client.send(deleteCommand)
            console.log('✅ Arquivo deletado do S3:', file.original_filename)
          } catch (s3Error) {
            console.error('⚠️ Erro ao deletar do S3 (continuando):', file.original_filename, s3Error.message)
          }
        }
      } else {
        console.log('⚠️ Credenciais AWS não encontradas, pulando delete do S3')
      }
    } catch (s3Error) {
      console.error('⚠️ Erro no delete S3 (continuando com banco):', s3Error.message)
    }

    // Deletar do banco de dados
    const { error: deleteError } = await supabase
      .from('lead_media_unified')
      .delete()
      .eq('company_id', company_id)
      .in('id', fileIds)

    if (deleteError) {
      console.error('❌ Erro ao deletar do banco:', deleteError)
      return res.status(500).json({
        error: 'Erro ao deletar do banco',
        message: deleteError.message
      })
    }

    console.log('✅ Arquivos deletados com sucesso:', filesToDelete.length)

    return res.status(200).json({
      success: true,
      message: `${filesToDelete.length} arquivo(s) deletado(s) com sucesso`,
      deletedFiles: filesToDelete.map(f => ({
        id: f.id,
        filename: f.original_filename
      }))
    })

  } catch (error) {
    console.error('❌ Erro na API de delete:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao deletar arquivos',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
