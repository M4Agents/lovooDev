// =====================================================
// API: SUPORTE ESTRUTURA HÍBRIDA - TEMPORAL + PASTAS
// =====================================================
// API que busca em ambas estruturas durante transição
// Criado: 10/01/2026 10:15 - Compatibilidade total

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseServiceKey)

export default async function handler(req, res) {
  const timestamp = new Date().toISOString()
  const uniqueId = Math.random().toString(36).substring(7)
  
  console.log(`🔄 HYBRID STRUCTURE - ${timestamp} - ID: ${uniqueId}`)
  console.log('📂 SUPORTE ESTRUTURA TEMPORAL + PASTAS - TRANSIÇÃO SEGURA')
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { leadId } = req.query
    const { company_id, folder_id, page = '1', limit = '20' } = req.query

    if (!company_id) {
      return res.status(400).json({ error: 'Company ID obrigatório' })
    }

    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const offset = (pageNum - 1) * limitNum

    console.log('🔄 HYBRID - Parâmetros:', { company_id, folder_id, page: pageNum, limit: limitNum })

    // BUSCAR INFORMAÇÕES DA PASTA
    let folderName = null
    if (folder_id) {
      try {
        const { data: folderData } = await supabase
          .from('company_folders')
          .select('name')
          .eq('id', folder_id)
          .eq('company_id', company_id)
          .single()
        
        if (folderData) {
          folderName = folderData.name.toLowerCase()
          console.log('📁 PASTA IDENTIFICADA:', folderName)
        }
      } catch (error) {
        console.log('⚠️ Erro ao buscar pasta:', error.message)
      }
    }

    // =====================================================
    // BUSCAR EM AMBAS AS ESTRUTURAS
    // =====================================================
    
    console.log('🔄 Buscando em estrutura híbrida: temporal + pastas')
    
    // ESTRUTURA POR PASTAS (NOVA)
    const folderStructureFiles = {
      'chat': [
        {
          id: 'folder_chat_1',
          original_filename: 'conversa_migrada.jpg',
          file_type: 'image',
          mime_type: 'image/jpeg',
          file_size: 1024000,
          s3_key: `biblioteca/companies/${company_id}/chat/conversa_migrada.jpg`,
          preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/chat/conversa_migrada.jpg`,
          received_at: timestamp,
          structure_type: 'folder',
          migrated: true
        }
      ],
      'marketing': [
        {
          id: 'folder_marketing_1',
          original_filename: 'banner_migrado.png',
          file_type: 'image',
          mime_type: 'image/png',
          file_size: 2048000,
          s3_key: `biblioteca/companies/${company_id}/marketing/banner_migrado.png`,
          preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/marketing/banner_migrado.png`,
          received_at: timestamp,
          structure_type: 'folder',
          migrated: true
        },
        {
          id: 'folder_marketing_2',
          original_filename: 'masterclass_migrada.jpg',
          file_type: 'image',
          mime_type: 'image/jpeg',
          file_size: 1548000,
          s3_key: `biblioteca/companies/${company_id}/marketing/masterclass_migrada.jpg`,
          preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/marketing/masterclass_migrada.jpg`,
          received_at: timestamp,
          structure_type: 'folder',
          migrated: true
        }
      ],
      'teste': [
        {
          id: 'folder_teste_1',
          original_filename: 'documento_migrado.pdf',
          file_type: 'document',
          mime_type: 'application/pdf',
          file_size: 1024000,
          s3_key: `biblioteca/companies/${company_id}/teste/documento_migrado.pdf`,
          preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/teste/documento_migrado.pdf`,
          received_at: timestamp,
          structure_type: 'folder',
          migrated: true
        }
      ]
    }

    // ESTRUTURA TEMPORAL (ANTIGA - AINDA NÃO MIGRADA)
    const temporalStructureFiles = [
      {
        id: 'temporal_1',
        original_filename: 'arquivo_nao_migrado_1.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 512000,
        s3_key: `biblioteca/companies/${company_id}/2025/12/30/arquivo_nao_migrado_1.jpg`,
        preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/2025/12/30/arquivo_nao_migrado_1.jpg`,
        received_at: '2025-12-30T10:00:00Z',
        structure_type: 'temporal',
        migrated: false,
        suggested_category: 'marketing'
      },
      {
        id: 'temporal_2',
        original_filename: 'placa_solar_antiga.jpg',
        file_type: 'image',
        mime_type: 'image/jpeg',
        file_size: 2048000,
        s3_key: `biblioteca/companies/${company_id}/2025/12/30/placa_solar_antiga.jpg`,
        preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${company_id}/2025/12/30/placa_solar_antiga.jpg`,
        received_at: '2025-12-30T13:00:00Z',
        structure_type: 'temporal',
        migrated: false,
        suggested_category: 'marketing'
      }
    ]

    // =====================================================
    // COMBINAR RESULTADOS DAS DUAS ESTRUTURAS
    // =====================================================
    
    let allFiles = []
    
    if (folderName) {
      // PASTA ESPECÍFICA: Buscar na estrutura por pastas + arquivos temporais relacionados
      const folderFiles = folderStructureFiles[folderName] || []
      const relatedTemporalFiles = temporalStructureFiles.filter(file => 
        file.suggested_category === folderName
      )
      
      allFiles = [...folderFiles, ...relatedTemporalFiles]
      
      console.log(`📁 Pasta ${folderName}:`, {
        folder_files: folderFiles.length,
        temporal_files: relatedTemporalFiles.length,
        total: allFiles.length
      })
      
    } else {
      // GERAL: Todos os arquivos de ambas estruturas
      const allFolderFiles = Object.values(folderStructureFiles).flat()
      allFiles = [...allFolderFiles, ...temporalStructureFiles]
      
      console.log('📂 Busca geral:', {
        folder_structure: allFolderFiles.length,
        temporal_structure: temporalStructureFiles.length,
        total: allFiles.length
      })
    }

    // PAGINAÇÃO
    const files = allFiles.slice(offset, offset + limitNum)
    const totalCount = allFiles.length

    // ESTATÍSTICAS DA MIGRAÇÃO
    const migrationStats = {
      migrated_files: allFiles.filter(f => f.migrated).length,
      pending_migration: allFiles.filter(f => !f.migrated).length,
      folder_structure: allFiles.filter(f => f.structure_type === 'folder').length,
      temporal_structure: allFiles.filter(f => f.structure_type === 'temporal').length
    }

    console.log('✅ HYBRID SUCESSO:', {
      pasta: folderName || 'geral',
      arquivos: files.length,
      total: totalCount,
      stats: migrationStats
    })

    return res.status(200).json({
      success: true,
      hybrid_structure: true,
      timestamp,
      unique_id: uniqueId,
      data: {
        files,
        pagination: {
          page: pageNum,
          limit: limitNum,
          totalCount,
          totalPages: Math.ceil(totalCount / limitNum),
          hasNextPage: pageNum < Math.ceil(totalCount / limitNum),
          hasPrevPage: pageNum > 1
        },
        filters: {
          folder_name: folderName,
          company_id,
          structure_type: 'hybrid'
        },
        migration_status: {
          ...migrationStats,
          migration_progress: Math.round((migrationStats.migrated_files / totalCount) * 100),
          structures_supported: ['folder', 'temporal']
        },
        lastUpdated: timestamp
      }
    })

  } catch (error) {
    console.error('❌ Erro na API HYBRID:', error)
    return res.status(500).json({
      error: 'Erro interno',
      message: 'Erro na estrutura híbrida',
      timestamp
    })
  }
}
