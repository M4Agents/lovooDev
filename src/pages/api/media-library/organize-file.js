// =====================================================
// API: ORGANIZAR ARQUIVO POR PASTA - APÓS UPLOAD
// =====================================================
// Endpoint para mover arquivo da estrutura temporal para pasta selecionada
// Criado: 10/01/2026 12:20 - Organização pós-upload

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
// HELPER: MOVER ARQUIVO NO S3
// =====================================================

const moveFileInS3 = async (companyId, folderName, originalS3Key, fileName) => {
  try {
    console.log('📁 Movendo arquivo no S3:', {
      original: originalS3Key,
      folder: folderName,
      fileName: fileName
    })
    
    // Determinar novo caminho S3
    const newS3Key = `biblioteca/companies/${companyId}/${folderName}/${fileName}`
    
    console.log('📂 Novo caminho S3:', newS3Key)
    
    // Primeiro, copiar arquivo para novo local
    const { data: copyData, error: copyError } = await supabase.storage
      .from('aws-lovoocrm-media')
      .copy(originalS3Key, newS3Key)
    
    if (copyError) {
      console.error('❌ Erro ao copiar arquivo no S3:', copyError)
      // Se copy falhar, tentar criar pasta e upload direto
      console.log('🔄 Tentando criar pasta e fazer upload direto...')
      
      // Buscar arquivo original
      const { data: downloadData, error: downloadError } = await supabase.storage
        .from('aws-lovoocrm-media')
        .download(originalS3Key)
      
      if (downloadError) {
        throw new Error(`Erro ao baixar arquivo original: ${downloadError.message}`)
      }
      
      // Upload para novo local
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('aws-lovoocrm-media')
        .upload(newS3Key, downloadData, {
          upsert: true,
          contentType: downloadData.type
        })
      
      if (uploadError) {
        throw new Error(`Erro ao fazer upload para nova pasta: ${uploadError.message}`)
      }
      
      console.log('✅ Arquivo copiado via download/upload para:', newS3Key)
    } else {
      console.log('✅ Arquivo copiado com sucesso no S3:', newS3Key)
    }
    
    // Tentar remover arquivo original (opcional, se falhar não é crítico)
    try {
      const { error: removeError } = await supabase.storage
        .from('aws-lovoocrm-media')
        .remove([originalS3Key])
      
      if (removeError) {
        console.warn('⚠️ Não foi possível remover arquivo original:', removeError.message)
      } else {
        console.log('✅ Arquivo original removido:', originalS3Key)
      }
    } catch (removeErr) {
      console.warn('⚠️ Erro ao remover arquivo original (não crítico):', removeErr.message)
    }
    
    return {
      success: true,
      old_s3_key: originalS3Key,
      new_s3_key: newS3Key,
      new_s3_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${newS3Key}`,
      folder_created: true
    }
    
  } catch (error) {
    console.error('❌ Erro no movimento S3:', error)
    throw error
  }
}

// =====================================================
// HELPER: ATUALIZAR METADADOS NO BANCO
// =====================================================

const updateFileMetadata = async (fileId, companyId, folderId, newS3Key, newS3Url) => {
  try {
    console.log('💾 Atualizando metadados no banco:', {
      file_id: fileId,
      folder_id: folderId,
      new_s3_key: newS3Key
    })
    
    const updateData = {
      folder_id: folderId,
      s3_key: newS3Key,
      preview_url: newS3Url,
      organized_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }
    
    const { data, error } = await supabase
      .from('company_media_library')
      .update(updateData)
      .eq('id', fileId)
      .eq('company_id', companyId)
      .select()
      .single()
    
    if (error) {
      console.error('❌ Erro ao atualizar metadados:', error)
      throw new Error(`Erro ao atualizar metadados: ${error.message}`)
    }
    
    console.log('✅ Metadados atualizados no banco:', data.id)
    return data
    
  } catch (error) {
    console.error('❌ Erro ao atualizar metadados:', error)
    throw error
  }
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  console.log('📁 ORGANIZE FILE - 2026-01-10 12:34 - ORGANIZAÇÃO PÓS-UPLOAD - REDEPLOY FORÇADO')
  console.log('✅ MOVENDO ARQUIVO PARA PASTA SELECIONADA - API ATIVA')
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas POST é permitido'
    })
  }

  try {
    const { file_id, company_id, folder_id, original_s3_key } = req.body
    
    if (!file_id || !company_id || !folder_id || !original_s3_key) {
      return res.status(400).json({
        error: 'Parâmetros obrigatórios',
        message: 'file_id, company_id, folder_id e original_s3_key são necessários'
      })
    }

    console.log('📁 Organização solicitada:', { 
      file_id, 
      company_id, 
      folder_id,
      original_s3_key
    })

    // Buscar informações da pasta
    let folderName = null
    try {
      const { data: folderData } = await supabase
        .from('company_folders')
        .select('name')
        .eq('id', folder_id)
        .eq('company_id', company_id)
        .single()
      
      if (folderData) {
        folderName = folderData.name.toLowerCase()
        console.log('📂 Organizando para pasta:', folderName)
      } else {
        throw new Error('Pasta não encontrada')
      }
    } catch (error) {
      console.error('❌ Erro ao buscar pasta:', error.message)
      return res.status(404).json({
        error: 'Pasta não encontrada',
        message: 'folder_id não existe para esta empresa'
      })
    }

    // Extrair nome do arquivo do S3 key original
    const fileName = original_s3_key.split('/').pop()
    
    // Mover arquivo no S3
    const moveResult = await moveFileInS3(
      company_id, 
      folderName, 
      original_s3_key, 
      fileName
    )
    
    // Atualizar metadados no banco
    const updatedFile = await updateFileMetadata(
      file_id,
      company_id,
      folder_id,
      moveResult.new_s3_key,
      moveResult.new_s3_url
    )
    
    console.log('🎉 Organização concluída com sucesso!')

    return res.status(200).json({
      success: true,
      message: `Arquivo organizado na pasta ${folderName}`,
      data: {
        file_id: file_id,
        company_id: company_id,
        folder_id: folder_id,
        folder_name: folderName,
        old_s3_path: original_s3_key,
        new_s3_path: moveResult.new_s3_key,
        new_s3_url: moveResult.new_s3_url,
        file: updatedFile
      }
    })

  } catch (error) {
    console.error('❌ Erro na organização:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro na organização do arquivo',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
