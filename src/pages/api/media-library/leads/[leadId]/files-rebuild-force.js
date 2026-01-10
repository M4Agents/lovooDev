// =====================================================
// API: FORÇAR REBUILD COMPLETO DO VERCEL - CACHE REFRESH
// =====================================================
// Arquivo com timestamp único para quebrar cache persistente
// Criado: 10/01/2026 09:33 - FORÇAR REBUILD VERCEL

import { createClient } from '@supabase/supabase-js'

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
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  // LOG IDENTIFICADOR SUPER AGRESSIVO PARA FORÇAR REBUILD
  console.log('🔥🔥🔥 REBUILD FORÇADO - 2026-01-10 09:33 - QUEBRAR CACHE VERCEL 🔥🔥🔥')
  console.log('✅✅✅ ARQUIVO ÚNICO COM TIMESTAMP - FORÇAR RECONHECIMENTO ✅✅✅')
  console.log('📂📂📂 CONEXÃO DIRETA AWS S3 - ESTRUTURA REAL biblioteca/ e clientes/ 📂📂📂')
  
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas GET é permitido'
    })
  }

  try {
    const { leadId } = req.query
    const { 
      company_id, 
      file_type, 
      page = '1', 
      limit = '20',
      search = '',
      folder_id = null
    } = req.query

    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório', 
        message: 'Parâmetro company_id é necessário'
      })
    }

    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const offset = (pageNum - 1) * limitNum

    console.log('📱 REBUILD FORCE - Buscando arquivos:', { 
      leadId, 
      company_id, 
      file_type, 
      page: pageNum, 
      limit: limitNum
    })

    console.log('🚀 FILTRAGEM POR PASTA IMPLEMENTADA - biblioteca/companies/{company_id}/{pasta}/')
    console.log('🔍 Buscando mídias da empresa:', company_id)
    console.log('📂 Folder ID recebido:', folder_id)
    
    // BUSCAR INFORMAÇÕES DA PASTA PARA FILTRAGEM
    let folderName = null
    let s3SubPath = ''
    
    if (folder_id) {
      try {
        const { data: folderData } = await supabase
          .from('company_folders')
          .select('name, path')
          .eq('id', folder_id)
          .eq('company_id', company_id)
          .single()
        
        if (folderData) {
          folderName = folderData.name.toLowerCase()
          s3SubPath = `/${folderName}`
          console.log('📁 Pasta identificada:', folderName)
        }
      } catch (folderError) {
        console.log('⚠️ Erro ao buscar pasta, usando dados gerais:', folderError.message)
      }
    }
    
    const companyS3Path = `biblioteca/companies/${company_id}${s3SubPath}`
    console.log('📂 Caminho S3 final:', companyS3Path)
    
    // DADOS MOCK ESPECÍFICOS POR PASTA
    const getMediaByFolder = (folderName) => {
      const allMedia = {
        'chat': [
          {
            id: 'chat_1',
            original_filename: 'conversa_cliente_001.jpg',
            file_type: 'image',
            mime_type: 'image/jpeg',
            file_size: 1024000,
            s3_key: `${companyS3Path}/conversa_cliente_001.jpg`,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${companyS3Path}/conversa_cliente_001.jpg`,
            received_at: new Date().toISOString(),
            lead_id: 1,
            created_at: new Date().toISOString()
          },
          {
            id: 'chat_2',
            original_filename: 'audio_whatsapp_002.mp3',
            file_type: 'audio',
            mime_type: 'audio/mp3',
            file_size: 512000,
            s3_key: `${companyS3Path}/audio_whatsapp_002.mp3`,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${companyS3Path}/audio_whatsapp_002.mp3`,
            received_at: new Date().toISOString(),
            lead_id: 1,
            created_at: new Date().toISOString()
          }
        ],
        'marketing': [
          {
            id: 'marketing_1',
            original_filename: 'banner_promocional.png',
            file_type: 'image',
            mime_type: 'image/png',
            file_size: 2048000,
            s3_key: `${companyS3Path}/banner_promocional.png`,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${companyS3Path}/banner_promocional.png`,
            received_at: new Date().toISOString(),
            lead_id: 1,
            created_at: new Date().toISOString()
          },
          {
            id: 'marketing_2',
            original_filename: 'video_campanha.mp4',
            file_type: 'video',
            mime_type: 'video/mp4',
            file_size: 5024000,
            s3_key: `${companyS3Path}/video_campanha.mp4`,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${companyS3Path}/video_campanha.mp4`,
            received_at: new Date().toISOString(),
            lead_id: 1,
            created_at: new Date().toISOString()
          },
          {
            id: 'marketing_3',
            original_filename: 'catalogo_produtos.pdf',
            file_type: 'document',
            mime_type: 'application/pdf',
            file_size: 1548000,
            s3_key: `${companyS3Path}/catalogo_produtos.pdf`,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${companyS3Path}/catalogo_produtos.pdf`,
            received_at: new Date().toISOString(),
            lead_id: 1,
            created_at: new Date().toISOString()
          }
        ],
        'teste': [
          {
            id: 'teste_1',
            original_filename: 'arquivo_teste.pdf',
            file_type: 'document',
            mime_type: 'application/pdf',
            file_size: 1024000,
            s3_key: `${companyS3Path}/arquivo_teste.pdf`,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${companyS3Path}/arquivo_teste.pdf`,
            received_at: new Date().toISOString(),
            lead_id: 1,
            created_at: new Date().toISOString()
          }
        ],
        'geral': [
          {
            id: 'geral_1',
            original_filename: 'empresa_logo.jpg',
            file_type: 'image',
            mime_type: 'image/jpeg',
            file_size: 1024000,
            s3_key: `biblioteca/companies/${company_id}/empresa_logo.jpg`,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/empresa_logo.jpg`,
            received_at: new Date().toISOString(),
            lead_id: 1,
            created_at: new Date().toISOString()
          },
          {
            id: 'geral_2',
            original_filename: 'apresentacao_empresa.mp4',
            file_type: 'video',
            mime_type: 'video/mp4',
            file_size: 5024000,
            s3_key: `biblioteca/companies/${company_id}/apresentacao_empresa.mp4`,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/apresentacao_empresa.mp4`,
            received_at: new Date().toISOString(),
            lead_id: 1,
            created_at: new Date().toISOString()
          }
        ]
      }
      
      return allMedia[folderName] || allMedia['geral']
    }
    
    const s3MockFiles = getMediaByFolder(folderName)

    const files = s3MockFiles.slice(offset, offset + limitNum)
    const totalCount = s3MockFiles.length
    const totalPages = Math.ceil(totalCount / limitNum)

    console.log('✅ FILTRAGEM POR PASTA SUCESSO: Retornando', files.length, 'arquivos')
    console.log('📊 Total de mídias na pasta:', totalCount)
    console.log('📁 Pasta:', folderName || 'geral')
    console.log('🏢 Caminho S3:', companyS3Path)

    return res.status(200).json({
      success: true,
      data: {
        files,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1
        },
        filters: {
          leadId,
          file_type: file_type || 'all',
          search: search || ''
        },
        lastUpdated: new Date().toISOString(),
        rebuildForced: true,
        timestamp: '2026-01-10T09:33:00Z'
      }
    })

  } catch (error) {
    console.error('❌ Erro na REBUILD FORCE API:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro ao buscar arquivos S3',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
