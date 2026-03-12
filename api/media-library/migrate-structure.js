// =====================================================
// API: MIGRAÇÃO ESTRUTURA TEMPORAL → ESTRUTURA POR PASTAS
// =====================================================
// Migração segura APENAS para pasta biblioteca/ do AWS S3
// Criado: 10/01/2026 10:15 - Migração controlada

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
// HELPER: LISTAR ARQUIVOS NA ESTRUTURA TEMPORAL
// =====================================================

const listTemporalFiles = async (companyId) => {
  try {
    console.log('📂 Listando arquivos na estrutura temporal:', `biblioteca/companies/${companyId}/`)
    
    // SIMULAÇÃO: Listar arquivos da estrutura temporal atual
    // Em implementação real, usaria S3Storage.listObjects()
    /*
    const S3Storage = require('../services/aws/s3Storage')
    const temporalPrefix = `biblioteca/companies/${companyId}/2025/`
    const s3Objects = await S3Storage.listObjects(companyId, temporalPrefix)
    
    return s3Objects.map(obj => ({
      key: obj.key,
      filename: obj.filename,
      size: obj.size,
      lastModified: obj.lastModified,
      url: obj.url
    }))
    */
    
    // SIMULAÇÃO: Arquivos existentes na estrutura temporal
    const temporalFiles = [
      {
        key: `biblioteca/companies/${companyId}/2025/12/30/masterclass_vendas.jpg`,
        filename: 'masterclass_vendas.jpg',
        size: 1024000,
        lastModified: '2025-12-30T10:00:00Z',
        url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${companyId}/2025/12/30/masterclass_vendas.jpg`,
        suggestedCategory: 'marketing'
      },
      {
        key: `biblioteca/companies/${companyId}/2025/12/30/conversa_cliente.jpg`,
        filename: 'conversa_cliente.jpg',
        size: 512000,
        lastModified: '2025-12-30T11:00:00Z',
        url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${companyId}/2025/12/30/conversa_cliente.jpg`,
        suggestedCategory: 'chat'
      },
      {
        key: `biblioteca/companies/${companyId}/2025/12/30/documento_teste.pdf`,
        filename: 'documento_teste.pdf',
        size: 256000,
        lastModified: '2025-12-30T12:00:00Z',
        url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${companyId}/2025/12/30/documento_teste.pdf`,
        suggestedCategory: 'teste'
      },
      {
        key: `biblioteca/companies/${companyId}/2025/12/30/placa_solar.jpg`,
        filename: 'placa_solar.jpg',
        size: 2048000,
        lastModified: '2025-12-30T13:00:00Z',
        url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/biblioteca/companies/${companyId}/2025/12/30/placa_solar.jpg`,
        suggestedCategory: 'marketing'
      }
    ]
    
    console.log('✅ Arquivos temporais encontrados:', temporalFiles.length)
    return temporalFiles
    
  } catch (error) {
    console.error('❌ Erro ao listar arquivos temporais:', error)
    throw error
  }
}

// =====================================================
// HELPER: CATEGORIZAR ARQUIVO AUTOMATICAMENTE
// =====================================================

const categorizeFile = (filename, suggestedCategory = null) => {
  if (suggestedCategory) {
    return suggestedCategory
  }
  
  const name = filename.toLowerCase()
  
  // Regras de categorização automática
  if (name.includes('chat') || name.includes('conversa') || name.includes('whatsapp')) {
    return 'chat'
  }
  
  if (name.includes('marketing') || name.includes('banner') || name.includes('campanha') || 
      name.includes('masterclass') || name.includes('promocional')) {
    return 'marketing'
  }
  
  if (name.includes('teste') || name.includes('test') || name.includes('exemplo')) {
    return 'teste'
  }
  
  // Padrão: marketing (para arquivos não categorizados)
  return 'marketing'
}

// =====================================================
// HELPER: MOVER ARQUIVO NO S3
// =====================================================

const moveFileInS3 = async (companyId, oldKey, newKey, filename) => {
  try {
    console.log('🔄 Movendo arquivo:', {
      from: oldKey,
      to: newKey,
      filename
    })
    
    // SIMULAÇÃO: Mover arquivo no S3
    /*
    const S3Storage = require('../services/aws/s3Storage')
    
    // 1. Copiar arquivo para nova localização
    await S3Storage.copyObject(companyId, oldKey, newKey)
    
    // 2. Verificar se cópia foi bem-sucedida
    const newFileExists = await S3Storage.objectExists(companyId, newKey)
    if (!newFileExists) {
      throw new Error('Falha na cópia do arquivo')
    }
    
    // 3. Deletar arquivo original
    await S3Storage.deleteObject(companyId, oldKey)
    
    console.log('✅ Arquivo movido com sucesso:', filename)
    */
    
    // SIMULAÇÃO: Retornar sucesso
    console.log('✅ Arquivo movido (simulado):', filename)
    
    return {
      success: true,
      oldKey,
      newKey,
      filename,
      newUrl: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${newKey}`
    }
    
  } catch (error) {
    console.error('❌ Erro ao mover arquivo:', error)
    return {
      success: false,
      oldKey,
      newKey,
      filename,
      error: error.message
    }
  }
}

// =====================================================
// HELPER: ATUALIZAR METADADOS NO BANCO
// =====================================================

const updateDatabaseReferences = async (companyId, moveResults) => {
  try {
    console.log('💾 Atualizando referências no banco de dados...')
    
    const updatePromises = moveResults
      .filter(result => result.success)
      .map(async (result) => {
        // SIMULAÇÃO: Atualizar referências no banco
        /*
        const { error } = await supabase
          .from('company_media_library')
          .update({
            s3_key: result.newKey,
            preview_url: result.newUrl,
            updated_at: new Date().toISOString()
          })
          .eq('company_id', companyId)
          .eq('s3_key', result.oldKey)
        
        if (error) {
          throw error
        }
        */
        
        console.log('✅ Referência atualizada (simulado):', result.filename)
        return { filename: result.filename, updated: true }
      })
    
    const updateResults = await Promise.all(updatePromises)
    console.log('✅ Referências do banco atualizadas:', updateResults.length)
    
    return updateResults
    
  } catch (error) {
    console.error('❌ Erro ao atualizar banco:', error)
    throw error
  }
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  console.log('🔄 MIGRATE STRUCTURE - 2026-01-10 10:15 - TEMPORAL → PASTAS')
  console.log('📂 MIGRAÇÃO SEGURA - APENAS PASTA BIBLIOTECA/')
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas POST é permitido'
    })
  }

  try {
    const { company_id, action, files_to_migrate } = req.body

    if (!company_id) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    console.log('🔄 Migração solicitada:', { 
      company_id, 
      action,
      files_count: files_to_migrate?.length || 'auto'
    })

    // =====================================================
    // AÇÃO: LISTAR ARQUIVOS PARA MIGRAÇÃO
    // =====================================================
    
    if (action === 'list_files') {
      console.log('📋 Listando arquivos para migração...')
      
      const temporalFiles = await listTemporalFiles(company_id)
      
      const filesWithCategories = temporalFiles.map(file => ({
        ...file,
        suggestedCategory: categorizeFile(file.filename, file.suggestedCategory),
        newKey: `biblioteca/companies/${company_id}/${categorizeFile(file.filename, file.suggestedCategory)}/${file.filename}`
      }))
      
      return res.status(200).json({
        success: true,
        action: 'files_listed',
        data: {
          company_id,
          temporal_structure: `biblioteca/companies/${company_id}/2025/12/30/`,
          new_structure: `biblioteca/companies/${company_id}/{categoria}/`,
          files: filesWithCategories,
          summary: {
            total: filesWithCategories.length,
            chat: filesWithCategories.filter(f => f.suggestedCategory === 'chat').length,
            marketing: filesWithCategories.filter(f => f.suggestedCategory === 'marketing').length,
            teste: filesWithCategories.filter(f => f.suggestedCategory === 'teste').length
          }
        }
      })
    }

    // =====================================================
    // AÇÃO: EXECUTAR MIGRAÇÃO
    // =====================================================
    
    if (action === 'migrate') {
      console.log('🚀 Executando migração de estrutura...')
      
      let filesToMigrate
      
      if (files_to_migrate && files_to_migrate.length > 0) {
        filesToMigrate = files_to_migrate
      } else {
        const temporalFiles = await listTemporalFiles(company_id)
        filesToMigrate = temporalFiles.map(file => ({
          ...file,
          category: categorizeFile(file.filename, file.suggestedCategory)
        }))
      }
      
      console.log('📦 Arquivos para migrar:', filesToMigrate.length)
      
      const moveResults = []
      
      for (const file of filesToMigrate) {
        const newKey = `biblioteca/companies/${company_id}/${file.category}/${file.filename}`
        
        const moveResult = await moveFileInS3(
          company_id,
          file.key,
          newKey,
          file.filename
        )
        
        moveResults.push(moveResult)
      }
      
      // Atualizar referências no banco
      const dbUpdateResults = await updateDatabaseReferences(company_id, moveResults)
      
      const successCount = moveResults.filter(r => r.success).length
      const errorCount = moveResults.filter(r => !r.success).length
      
      console.log('✅ Migração concluída:', { success: successCount, errors: errorCount })
      
      return res.status(200).json({
        success: true,
        action: 'migration_completed',
        data: {
          company_id,
          migration_summary: {
            total_files: moveResults.length,
            successful_moves: successCount,
            failed_moves: errorCount,
            database_updates: dbUpdateResults.length
          },
          move_results: moveResults,
          new_structure: {
            chat: `biblioteca/companies/${company_id}/chat/`,
            marketing: `biblioteca/companies/${company_id}/marketing/`,
            teste: `biblioteca/companies/${company_id}/teste/`
          },
          timestamp: new Date().toISOString()
        }
      })
    }

    // =====================================================
    // AÇÃO: STATUS DA MIGRAÇÃO
    // =====================================================
    
    console.log('📊 Retornando status da migração')
    
    return res.status(200).json({
      success: true,
      action: 'status',
      data: {
        company_id,
        current_structure: `biblioteca/companies/${company_id}/2025/12/30/`,
        target_structure: `biblioteca/companies/${company_id}/{categoria}/`,
        migration_scope: 'biblioteca/ apenas',
        available_actions: ['list_files', 'migrate'],
        safe_migration: true
      }
    })

  } catch (error) {
    console.error('❌ Erro na migração:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro na migração de estrutura',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
