// =====================================================
// API: UPLOAD PARA SUBPASTA ESPECÍFICA - ESTRUTURA FÍSICA S3
// =====================================================
// Endpoint para upload direto na subpasta correta do S3
// Criado: 10/01/2026 10:05 - Upload organizado

import { createClient } from '@supabase/supabase-js'
import formidable from 'formidable'
import fs from 'fs'

// =====================================================
// CONFIGURAÇÃO SUPABASE
// =====================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Supabase configuration missing')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// Desabilitar parser padrão do Next.js para multipart
export const config = {
  api: {
    bodyParser: false,
  },
}

// =====================================================
// HELPER: UPLOAD PARA SUBPASTA S3
// =====================================================

const uploadToS3Subfolder = async (companyId, folderName, file, fileName) => {
  try {
    console.log('📤 Upload para subpasta S3:', {
      company_id: companyId,
      folder: folderName,
      file: fileName,
      size: file.size
    })
    
    // Determinar subpasta baseada no folder
    const s3SubPath = folderName ? `biblioteca/companies/${companyId}/${folderName}/` : `biblioteca/companies/${companyId}/`
    const s3Key = `${s3SubPath}${fileName}`
    
    console.log('📂 Caminho S3 de destino:', s3Key)
    
    // Upload REAL para S3 usando Supabase Storage (igual ao que funcionava antes)
    const fileBuffer = fs.readFileSync(file.filepath)
    
    console.log('📤 Upload REAL para S3:', s3Key)
    console.log('📂 Criando pasta automaticamente:', folderName ? `biblioteca/companies/${companyId}/${folderName}/` : `biblioteca/companies/${companyId}/`)
    
    // Upload real usando Supabase Storage (mesmo método que funcionava)
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('aws-lovoocrm-media')
      .upload(s3Key, fileBuffer, {
        contentType: file.mimetype,
        upsert: true, // Permite sobrescrever se já existir
        metadata: {
          'original-filename': fileName,
          'uploaded-by': 'media-library',
          'folder': folderName || 'root',
          'uploaded-at': new Date().toISOString()
        }
      })
    
    if (uploadError) {
      console.error('❌ Erro no upload S3:', uploadError)
      throw new Error(`Erro no upload S3: ${uploadError.message}`)
    }
    
    console.log('✅ Upload S3 REAL bem-sucedido para pasta:', folderName || 'root')
    console.log('📁 Pasta criada automaticamente no S3:', uploadData.path)
    
    return {
      success: true,
      s3_key: s3Key,
      s3_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${s3Key}`,
      file_size: file.size,
      mime_type: file.mimetype,
      upload_path: uploadData.path,
      folder_created: true
    }
    
  } catch (error) {
    console.error('❌ Erro no upload S3:', error)
    throw error
  }
}

// =====================================================
// HELPER: SALVAR METADADOS NO BANCO
// =====================================================

const saveFileMetadata = async (companyId, folderId, uploadResult, originalFilename) => {
  try {
    console.log('💾 Salvando metadados no banco:', {
      company_id: companyId,
      folder_id: folderId,
      filename: originalFilename
    })
    
    const fileMetadata = {
      company_id: companyId,
      folder_id: folderId,
      original_filename: originalFilename,
      s3_key: uploadResult.s3_key,
      file_size: uploadResult.file_size,
      mime_type: uploadResult.mime_type,
      file_type: uploadResult.mime_type.split('/')[0], // image, video, audio, application
      preview_url: uploadResult.s3_url,
      uploaded_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    }
    
    // Salvar metadados REAIS no banco (igual ao que funcionava antes)
    const { data, error } = await supabase
      .from('company_media_library')
      .insert([fileMetadata])
      .select()
      .single()
    
    if (error) {
      console.error('❌ Erro ao salvar metadados:', error)
      throw new Error(`Erro ao salvar metadados: ${error.message}`)
    }
    
    console.log('✅ Metadados salvos REAIS no banco:', data.id)
    return data
    
  } catch (error) {
    console.error('❌ Erro ao salvar metadados:', error)
    throw error
  }
}

// =====================================================
// HANDLER PRINCIPAL
// =====================================================

export default async function handler(req, res) {
  console.log('📤 UPLOAD TO FOLDER - 2026-01-10 10:05 - SUBPASTAS FÍSICAS S3')
  console.log('✅ UPLOAD ORGANIZADO POR PASTA - ESTRUTURA REAL')
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: 'Apenas POST é permitido'
    })
  }

  try {
    // Parse do formulário multipart
    const form = formidable({
      maxFileSize: 100 * 1024 * 1024, // 100MB
      keepExtensions: true,
    })

    const [fields, files] = await form.parse(req)
    
    const companyId = Array.isArray(fields.company_id) ? fields.company_id[0] : fields.company_id
    const folderId = Array.isArray(fields.folder_id) ? fields.folder_id[0] : fields.folder_id
    const organizeExisting = Array.isArray(fields.organize_existing_file) ? fields.organize_existing_file[0] : fields.organize_existing_file
    const existingFileId = Array.isArray(fields.existing_file_id) ? fields.existing_file_id[0] : fields.existing_file_id
    const existingS3Key = Array.isArray(fields.existing_s3_key) ? fields.existing_s3_key[0] : fields.existing_s3_key
    
    if (!companyId) {
      return res.status(400).json({
        error: 'Company ID obrigatório',
        message: 'Parâmetro company_id é necessário'
      })
    }

    console.log('📤 Upload solicitado:', { 
      company_id: companyId, 
      folder_id: folderId,
      organize_existing: organizeExisting,
      existing_file_id: existingFileId,
      files_count: Object.keys(files).length
    })

    // Se for organização de arquivo existente
    if (organizeExisting === 'true') {
      console.log('🔄 ORGANIZANDO ARQUIVO EXISTENTE:', existingFileId)
      
      if (!existingFileId || !existingS3Key) {
        return res.status(400).json({
          error: 'Parâmetros obrigatórios para organização',
          message: 'existing_file_id e existing_s3_key são necessários'
        })
      }

      // Buscar informações da pasta
      let folderName = null
      try {
        const { data: folderData } = await supabase
          .from('company_folders')
          .select('name')
          .eq('id', folderId)
          .eq('company_id', companyId)
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
      const fileName = existingS3Key.split('/').pop()
      const newS3Key = `biblioteca/companies/${companyId}/${folderName}/${fileName}`
      
      console.log('📁 Movendo arquivo:', existingS3Key, '→', newS3Key)

      try {
        // Copiar arquivo para novo local
        const { data: copyData, error: copyError } = await supabase.storage
          .from('aws-lovoocrm-media')
          .copy(existingS3Key, newS3Key)
        
        if (copyError) {
          console.error('❌ Erro ao copiar:', copyError)
          // Fallback: download + upload
          const { data: downloadData, error: downloadError } = await supabase.storage
            .from('aws-lovoocrm-media')
            .download(existingS3Key)
          
          if (!downloadError) {
            const { error: uploadError } = await supabase.storage
              .from('aws-lovoocrm-media')
              .upload(newS3Key, downloadData, { upsert: true })
            
            if (uploadError) {
              throw new Error(`Erro no upload: ${uploadError.message}`)
            }
          }
        }

        // Atualizar metadados no banco
        const { data: updatedFile, error: updateError } = await supabase
          .from('company_media_library')
          .update({
            folder_id: folderId,
            s3_key: newS3Key,
            preview_url: `https://aws-lovoocrm-media.s3.sa-east-1.amazonaws.com/${newS3Key}`,
            organized_at: new Date().toISOString()
          })
          .eq('id', existingFileId)
          .eq('company_id', companyId)
          .select()
          .single()

        if (updateError) {
          console.error('❌ Erro ao atualizar metadados:', updateError)
        }

        // Remover arquivo original
        try {
          await supabase.storage.from('aws-lovoocrm-media').remove([existingS3Key])
          console.log('✅ Arquivo original removido')
        } catch (removeError) {
          console.warn('⚠️ Não foi possível remover arquivo original')
        }

        console.log('🎉 Arquivo organizado com sucesso!')

        return res.status(200).json({
          success: true,
          message: `Arquivo organizado na pasta ${folderName}`,
          data: {
            file_id: existingFileId,
            old_s3_path: existingS3Key,
            new_s3_path: newS3Key,
            folder_name: folderName
          }
        })

      } catch (organizeError) {
        console.error('❌ Erro na organização:', organizeError)
        return res.status(500).json({
          error: 'Erro na organização',
          message: organizeError.message
        })
      }
    }

    // Buscar informações da pasta
    let folderName = null
    if (folderId) {
      try {
        const { data: folderData } = await supabase
          .from('company_folders')
          .select('name')
          .eq('id', folderId)
          .eq('company_id', companyId)
          .single()
        
        if (folderData) {
          folderName = folderData.name.toLowerCase()
          console.log('📁 Upload para pasta:', folderName)
        }
      } catch (error) {
        console.log('⚠️ Erro ao buscar pasta, usando pasta raiz:', error.message)
      }
    }

    const uploadResults = []

    // Processar cada arquivo
    for (const [fieldName, fileArray] of Object.entries(files)) {
      const fileList = Array.isArray(fileArray) ? fileArray : [fileArray]
      
      for (const file of fileList) {
        console.log('📄 Processando arquivo:', file.originalFilename)
        
        try {
          // Upload para S3 na subpasta correta
          const uploadResult = await uploadToS3Subfolder(
            companyId, 
            folderName, 
            file, 
            file.originalFilename
          )
          
          // Salvar metadados no banco
          const fileMetadata = await saveFileMetadata(
            companyId, 
            folderId, 
            uploadResult, 
            file.originalFilename
          )
          
          uploadResults.push({
            success: true,
            file: fileMetadata,
            s3_path: uploadResult.s3_key,
            folder: folderName || 'root'
          })
          
          console.log('✅ Upload concluído:', file.originalFilename)
          
        } catch (fileError) {
          console.error('❌ Erro no upload do arquivo:', fileError)
          uploadResults.push({
            success: false,
            filename: file.originalFilename,
            error: fileError.message
          })
        }
      }
    }

    const successCount = uploadResults.filter(r => r.success).length
    const errorCount = uploadResults.filter(r => !r.success).length

    console.log('📊 Upload finalizado:', { success: successCount, errors: errorCount })

    return res.status(200).json({
      success: true,
      message: `${successCount} arquivo(s) enviado(s) com sucesso`,
      data: {
        company_id: companyId,
        folder_id: folderId,
        folder_name: folderName,
        s3_subfolder: folderName ? `biblioteca/companies/${companyId}/${folderName}/` : `biblioteca/companies/${companyId}/`,
        uploads: uploadResults,
        summary: {
          total: uploadResults.length,
          success: successCount,
          errors: errorCount
        }
      }
    })

  } catch (error) {
    console.error('❌ Erro no upload:', error)
    
    return res.status(500).json({
      error: 'Erro interno do servidor',
      message: 'Erro no upload de arquivos',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
}
